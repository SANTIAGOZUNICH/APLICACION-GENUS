/**
 * Observaciones transversales de Producción — lectura unificada (SOLO LECTURA sobre las entregas; la única escritura es el «visto»).
 *
 * Fuentes REALES (no se duplica ningún texto):
 *  - work_item_delivery_lines.observations  → entregas parciales/totales (Elaboración/Envasado/Codificado → Producción);
 *  - work_item_codificado_transfers.note     → entregas parciales de Envasado a Codificado;
 *  - work_item_deliveries.observations       → entregas anteriores a los renglones (solo si NO tienen renglones; las sincronizadas se excluyen);
 *  - work_items.operational_observation      → Elaboración → Envasado (solo si se actualizó en el mismo instante del evento SENT_TO_ENVASADO);
 *  - work_items.codificado_observation       → envío completo anterior Envasado → Codificado (solo si Codificado todavía no entregó);
 *  - deposito_graneles.observation           → sobrante de granel (vinculado por work_item_id).
 * Cada observación queda ligada al trabajo (work_items.id) de su entrega; la CADENA se arma con relaciones reales (ver buildChains).
 */
import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { isMissingSchemaError } from "@/lib/db/missing-schema";
import { internalDeliveryChanges, productionObservationSeen, productionPedidos, workItems } from "@/lib/db/schema";
import { PlanningForbiddenError, PlanningNotFoundError, PlanningValidationError } from "@/lib/planning/types";
import {
  ORIGIN_LABEL,
  applyFeedFilters,
  buildChains,
  canSeeChain,
  canViewProductionObservations,
  chainIndex,
  cleanObservationText,
  countObservations,
  dedupeObservations,
  isAdminObservationSector,
  sectorLabel,
  sortChronological,
  sortNewestFirst,
  tipoFromPending,
  withNewFlag,
  type ChainLink,
  type ChainNode,
  type FeedFilters,
  type ObservationCandidate,
  type ObservationOrigin,
  type ProductionObservation,
} from "./production-observations-core";

export interface ObservationActor {
  email: string;
  sector: string;
  displayName?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FEED_SCOPE = "FEED";
const MAX_SOURCE_ROWS = 1500;
const MAX_NODES = 800;
const DEFAULT_FEED_DAYS = 90;

const sectorOf = (a: ObservationActor) => String(a.sector ?? "").toUpperCase();
const userKey = (a: ObservationActor) => String(a.email ?? "").trim().toLowerCase();
const norm = (raw: string) => (String(raw ?? "").trim().startsWith("native:") ? String(raw).trim().slice(7) : String(raw ?? "").trim());
const uuidList = (ids: readonly string[]) => sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
const textList = (ids: readonly string[]) => sql.join(ids.map((i) => sql`${i}`), sql`, `);

type Db = ReturnType<typeof getDb>;
type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => ((res as { rows?: Row[] }).rows ?? []) as Row[];
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const numOrNull = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

function assertCanView(actor: ObservationActor) {
  if (!canViewProductionObservations(sectorOf(actor))) throw new PlanningForbiddenError("No tenés permiso para consultar las observaciones de Producción.");
}

// ───────────────────────── Fuentes ─────────────────────────

/** Observación cruda de una fuente, todavía sin los datos del trabajo (cliente, producto, pedido…). */
type RawObservation = Omit<ObservationCandidate, "workItemSector" | "workItemDeleted" | "pedidoId" | "pedidoOp" | "client" | "product" | "orderNumber" | "lote">;

interface SourceFilter {
  /** Solo estos trabajos (modo trabajo). Sin esto se usa la ventana de fechas. */
  workItemIds?: readonly string[];
  from?: Date | null;
  to?: Date | null;
  limit: number;
}

async function loadRawObservations(db: Db, f: SourceFilter): Promise<RawObservation[]> {
  const ids = f.workItemIds && f.workItemIds.length > 0 ? [...f.workItemIds] : null;
  if (f.workItemIds && !ids) return [];
  const range = (col: ReturnType<typeof sql>) => sql`${f.from ? sql`and ${col} >= ${f.from.toISOString()}::timestamptz` : sql``} ${f.to ? sql`and ${col} < ${f.to.toISOString()}::timestamptz` : sql``}`;
  const out: RawObservation[] = [];

  // 1) Renglones de entrega (parcial / total).
  const lines = rowsOf(
    await db.execute(sql`
      select l.id, l.work_item_id, l.sequence, l.quantity, l.unit, l.status, l.source_sector, l.delivered_by, l.delivered_by_sector,
             l.actual_delivered_at, l.observations, l.pending_after
        from work_item_delivery_lines l
       where l.observations is not null and btrim(l.observations) <> ''
         ${ids ? sql`and l.work_item_id in (${uuidList(ids)})` : range(sql`l.actual_delivered_at`)}
       order by l.actual_delivered_at desc limit ${f.limit}`)
  );
  for (const r of lines) {
    const text = cleanObservationText(r.observations as string);
    if (!text) continue;
    out.push({
      id: `ENTREGA_PRODUCCION:${r.id}`,
      origin: "ENTREGA_PRODUCCION",
      originLabel: ORIGIN_LABEL.ENTREGA_PRODUCCION,
      deliveryId: String(r.id),
      sequence: numOrNull(r.sequence),
      sector: String(r.source_sector),
      sectorLabel: sectorLabel(String(r.source_sector)),
      deliveredBy: String(r.delivered_by),
      deliveredBySector: (r.delivered_by_sector as string | null) ?? null,
      at: iso(r.actual_delivered_at),
      tipo: tipoFromPending(numOrNull(r.pending_after)),
      quantity: numOrNull(r.quantity),
      unit: (r.unit as string | null) ?? null,
      text,
      anulada: r.status !== "ACTIVA",
      edited: false,
      workItemId: String(r.work_item_id),
    });
  }

  // 2) Entregas parciales de Envasado a Codificado. Pertenecen al trabajo de Envasado (work_item_id); el de Codificado queda en su cadena.
  const transfers = rowsOf(
    await db.execute(sql`
      select t.id, t.work_item_id, t.seq, t.quantity, t.pending, t.origin_sector, t.delivered_by, t.delivered_by_name, t.delivered_by_sector,
             t.delivered_at, t.status, t.note, w.unit
        from work_item_codificado_transfers t join work_items w on w.id = t.work_item_id
       where t.note is not null and btrim(t.note) <> ''
         ${ids ? sql`and (t.work_item_id in (${uuidList(ids)}) or t.codificado_item_id in (${uuidList(ids)}))` : range(sql`t.delivered_at`)}
       order by t.delivered_at desc limit ${f.limit}`)
  );
  for (const r of transfers) {
    const text = cleanObservationText(r.note as string);
    if (!text) continue;
    out.push({
      id: `ENTREGA_CODIFICADO:${r.id}`,
      origin: "ENTREGA_CODIFICADO",
      originLabel: ORIGIN_LABEL.ENTREGA_CODIFICADO,
      deliveryId: String(r.id),
      sequence: numOrNull(r.seq),
      sector: String(r.origin_sector),
      sectorLabel: sectorLabel(String(r.origin_sector)),
      deliveredBy: String(r.delivered_by_name ?? r.delivered_by),
      deliveredBySector: (r.delivered_by_sector as string | null) ?? null,
      at: iso(r.delivered_at),
      tipo: tipoFromPending(numOrNull(r.pending)),
      quantity: numOrNull(r.quantity),
      unit: (r.unit as string | null) ?? null,
      text,
      anulada: r.status !== "ACTIVA",
      edited: false,
      workItemId: String(r.work_item_id),
    });
  }

  // 3) Entregas agregadas históricas SIN renglones (anteriores a las entregas parciales). Las sincronizadas se excluyen por su marca.
  const historic = rowsOf(
    await db.execute(sql`
      select d.id, d.work_item_id, d.quantity, d.unit, d.status, d.source_sector, d.delivered_by, d.delivered_by_sector, d.actual_delivered_at,
             d.observations, d.delivery_complete
        from work_item_deliveries d
       where d.observations is not null and btrim(d.observations) <> '' and d.status in ('ENTREGADO', 'ANULADO')
         and not exists (select 1 from work_item_delivery_lines l where l.delivery_id = d.id)
         ${ids ? sql`and d.work_item_id in (${uuidList(ids)})` : range(sql`d.actual_delivered_at`)}
       order by d.actual_delivered_at desc limit ${f.limit}`)
  );
  for (const r of historic) {
    const text = cleanObservationText(r.observations as string);
    if (!text) continue;
    out.push({
      id: `ENTREGA_HISTORICA:${r.id}`,
      origin: "ENTREGA_HISTORICA",
      originLabel: ORIGIN_LABEL.ENTREGA_HISTORICA,
      deliveryId: String(r.id),
      sequence: null,
      sector: String(r.source_sector),
      sectorLabel: sectorLabel(String(r.source_sector)),
      deliveredBy: String(r.delivered_by),
      deliveredBySector: (r.delivered_by_sector as string | null) ?? null,
      at: iso(r.actual_delivered_at),
      tipo: r.delivery_complete === false ? "PARCIAL" : r.delivery_complete === true ? "TOTAL" : null,
      quantity: numOrNull(r.quantity),
      unit: (r.unit as string | null) ?? null,
      text,
      anulada: r.status !== "ENTREGADO",
      edited: false,
      workItemId: String(r.work_item_id),
    });
  }

  // 4) Elaboración → Envasado: la observación del envío. Solo si el trabajo se actualizó en el MISMO instante del evento (±10 s):
  // si después otro flujo cambió la observación de avance, no se la atribuye al envío.
  const envios = rowsOf(
    await db.execute(sql`
      select w.id, w.operational_observation, w.finished_qty, w.unit, w.progress_updated_by, e.created_at, e.actor_email
        from work_items w join operational_events e on e.work_item_id = w.id and e.type = 'SENT_TO_ENVASADO'
       where w.sector = 'ELABORACION' and w.operational_observation is not null and btrim(w.operational_observation) <> ''
         and w.progress_updated_at is not null and abs(extract(epoch from (w.progress_updated_at - e.created_at))) <= 10
         ${ids ? sql`and w.id in (${uuidList(ids)})` : range(sql`e.created_at`)}
       order by e.created_at desc limit ${f.limit}`)
  );
  for (const r of envios) {
    const text = cleanObservationText(r.operational_observation as string);
    if (!text) continue;
    out.push({
      id: `ENVIO_ENVASADO:${r.id}`,
      origin: "ENVIO_ENVASADO",
      originLabel: ORIGIN_LABEL.ENVIO_ENVASADO,
      deliveryId: String(r.id),
      sequence: null,
      sector: "ELABORACION",
      sectorLabel: sectorLabel("ELABORACION"),
      deliveredBy: String(r.progress_updated_by ?? r.actor_email),
      deliveredBySector: null,
      at: iso(r.created_at),
      tipo: null,
      quantity: numOrNull(String(r.finished_qty ?? "").replace(",", ".")),
      unit: (r.unit as string | null) ?? null,
      text,
      anulada: false,
      edited: false,
      workItemId: String(r.id),
    });
  }

  // 5) Envío completo anterior Envasado → Codificado (mismo trabajo). Solo si Codificado todavía no entregó (la entrega puede reescribir el campo).
  const legacy = rowsOf(
    await db.execute(sql`
      select w.id, w.codificado_observation, w.codificado_origin_sector, w.packaging_total_units, w.unit, w.sent_to_codificado_by, e.created_at, e.actor_email
        from work_items w
        join lateral (select created_at, actor_email from operational_events x where x.work_item_id = w.id and x.type in ('SENT_TO_CODIFICADO', 'RESENT_TO_CODIFICADO') order by x.created_at desc limit 1) e on true
       where w.codificado_observation is not null and btrim(w.codificado_observation) <> '' and w.codificado_origin_sector is not null
         and not exists (select 1 from operational_events d where d.work_item_id = w.id and d.type = 'DELIVERED_FROM_CODIFICADO')
         ${ids ? sql`and w.id in (${uuidList(ids)})` : range(sql`e.created_at`)}
       order by e.created_at desc limit ${f.limit}`)
  );
  for (const r of legacy) {
    const text = cleanObservationText(r.codificado_observation as string);
    if (!text) continue;
    const origin = String(r.codificado_origin_sector);
    out.push({
      id: `ENVIO_CODIFICADO:${r.id}`,
      origin: "ENVIO_CODIFICADO",
      originLabel: ORIGIN_LABEL.ENVIO_CODIFICADO,
      deliveryId: String(r.id),
      sequence: null,
      sector: origin,
      sectorLabel: sectorLabel(origin),
      deliveredBy: String(r.sent_to_codificado_by ?? r.actor_email),
      deliveredBySector: null,
      at: iso(r.created_at),
      tipo: "TOTAL",
      quantity: numOrNull(r.packaging_total_units),
      unit: (r.unit as string | null) ?? null,
      text,
      anulada: false,
      edited: false,
      workItemId: String(r.id),
    });
  }

  // 6) Sobrante de granel (observación del registro en Depósito), vinculado por el id real del trabajo.
  const graneles = rowsOf(
    await db.execute(sql`
      select g.id, g.work_item_id, g.origin_sector, g.reported_by, g.observation, g.status, g.created_at
        from deposito_graneles g
       where g.observation is not null and btrim(g.observation) <> '' and g.work_item_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         ${ids ? sql`and g.work_item_id in (${textList(ids)})` : range(sql`g.created_at`)}
       order by g.created_at desc limit ${f.limit}`)
  );
  for (const r of graneles) {
    const text = cleanObservationText(r.observation as string);
    if (!text) continue;
    const origin = String(r.origin_sector ?? "ELABORACION").toUpperCase();
    out.push({
      id: `SOBRANTE_GRANEL:${r.id}`,
      origin: "SOBRANTE_GRANEL",
      originLabel: ORIGIN_LABEL.SOBRANTE_GRANEL,
      deliveryId: String(r.id),
      sequence: null,
      sector: origin,
      sectorLabel: sectorLabel(origin),
      deliveredBy: String(r.reported_by),
      deliveredBySector: null,
      at: iso(r.created_at),
      tipo: null,
      quantity: null,
      unit: null,
      text,
      anulada: r.status === "ANULADO",
      edited: false,
      workItemId: String(r.work_item_id).toLowerCase(),
    });
  }
  return out;
}

/** Marca las observaciones cuyo texto fue corregido después de cargarse (historial en internal_delivery_changes). */
async function markEdited(db: Db, list: RawObservation[]): Promise<void> {
  const ids = list.filter((o) => o.origin === "ENTREGA_PRODUCCION" || o.origin === "ENTREGA_CODIFICADO").map((o) => o.deliveryId);
  if (ids.length === 0) return;
  const rows = await db
    .select({ id: internalDeliveryChanges.deliveryId })
    .from(internalDeliveryChanges)
    .where(and(inArray(internalDeliveryChanges.deliveryId, ids), eq(internalDeliveryChanges.action, "EDITAR"), sql`${internalDeliveryChanges.oldObservations} is distinct from ${internalDeliveryChanges.newObservations}`));
  const edited = new Set(rows.map((r) => r.id));
  for (const o of list) if (edited.has(o.deliveryId)) o.edited = true;
}

// ───────────────────────── Trabajos y cadena ─────────────────────────

interface ItemRow extends ChainNode {
  client: string;
  product: string;
  orderNumber: string | null;
  lote: string | null;
  pedidoOp: string | null;
}

const itemCols = {
  id: workItems.id,
  sector: workItems.sector,
  productionPedidoId: workItems.productionPedidoId,
  orderId: workItems.orderId,
  scheduleRootId: workItems.scheduleRootId,
  parentWorkItemId: workItems.parentWorkItemId,
  deletedAt: workItems.deletedAt,
  client: workItems.client,
  product: workItems.product,
  orderNumber: workItems.orderNumber,
  lote: workItems.packagingLote,
  pedidoOp: productionPedidos.op,
};

async function fetchItems(db: Db, where: ReturnType<typeof sql>): Promise<ItemRow[]> {
  const rows = await db
    .select(itemCols)
    .from(workItems)
    .leftJoin(productionPedidos, eq(productionPedidos.id, workItems.productionPedidoId))
    .where(where)
    .limit(MAX_NODES);
  return rows.map((r) => ({
    id: r.id,
    sector: String(r.sector),
    productionPedidoId: r.productionPedidoId ?? null,
    orderId: r.orderId ?? null,
    scheduleRootId: r.scheduleRootId ?? null,
    parentWorkItemId: r.parentWorkItemId ?? null,
    deleted: r.deletedAt != null,
    client: r.client,
    product: r.product,
    orderNumber: r.orderNumber ?? null,
    lote: r.lote ?? null,
    pedidoOp: r.pedidoOp ?? null,
  }));
}

/** Trabajos de la cadena de los `seedIds` (relaciones reales: pedido, programación raíz, orden, padre/hijo, envío de Elaboración). */
async function loadChainNodes(db: Db, seedIds: readonly string[]): Promise<{ nodes: Map<string, ItemRow>; links: ChainLink[] }> {
  const nodes = new Map<string, ItemRow>();
  const links = new Map<string, ChainLink>();
  let pending = [...new Set(seedIds)];
  for (let round = 0; round < 4 && pending.length > 0 && nodes.size < MAX_NODES; round++) {
    for (const r of await fetchItems(db, sql`${workItems.id} in (${uuidList(pending)})`)) nodes.set(r.id, r);
    const all = [...nodes.values()];
    const ids = all.map((n) => n.id);
    const pedidos = [...new Set(all.map((n) => n.productionPedidoId).filter((x): x is string => Boolean(x)))];
    const orders = [...new Set(all.map((n) => n.orderId).filter((x): x is string => Boolean(x)))];
    const roots = [...new Set([...all.map((n) => n.scheduleRootId).filter((x): x is string => Boolean(x)), ...ids])];
    const parents = [...new Set(all.map((n) => n.parentWorkItemId).filter((x): x is string => Boolean(x)))];
    const conds = [sql`${workItems.scheduleRootId} in (${uuidList(roots)})`, sql`${workItems.parentWorkItemId} in (${uuidList(ids)})`];
    if (pedidos.length) conds.push(sql`${workItems.productionPedidoId} in (${uuidList(pedidos)})`);
    if (orders.length) conds.push(sql`${workItems.orderId} in (${uuidList(orders)})`);
    if (parents.length) conds.push(sql`${workItems.id} in (${uuidList(parents)})`);
    if (all.some((n) => n.scheduleRootId)) conds.push(sql`${workItems.id} in (${uuidList(roots)})`);
    const found = await fetchItems(db, sql.join(conds.map((c) => sql`(${c})`), sql` or `));
    // Envío Elaboración → Envasado (evento real en el trabajo de destino: `from=<id del de Elaboración>`).
    const patterns = ids.map((i) => `%from=${i}%`);
    const events = rowsOf(
      await db.execute(sql`
        select work_item_id, note from operational_events
         where type = 'RECEIVED_FROM_ELABORACION' and (work_item_id in (${uuidList(ids)}) or note like any (array[${textList(patterns)}]::text[]))
         limit 2000`)
    );
    const extra: string[] = [];
    for (const e of events) {
      const from = /from=([0-9a-f-]{36})/i.exec(String(e.note ?? ""))?.[1]?.toLowerCase();
      const to = String(e.work_item_id);
      if (!from) continue;
      links.set(`${from}>${to}`, { from, to });
      for (const x of [from, to]) if (!nodes.has(x)) extra.push(x);
    }
    pending = [...new Set([...found.map((f) => f.id), ...extra])].filter((x) => !nodes.has(x));
    for (const f of found) nodes.set(f.id, f);
  }
  return { nodes, links: [...links.values()] };
}

/** Une datos del trabajo a cada observación cruda. Las que no tienen trabajo conocido se descartan (no se inventan vínculos). */
function enrich(raws: RawObservation[], items: Map<string, ItemRow>): ObservationCandidate[] {
  const out: ObservationCandidate[] = [];
  for (const o of raws) {
    const it = items.get(o.workItemId);
    if (!it) continue;
    out.push({
      ...o,
      workItemSector: it.sector,
      workItemDeleted: it.deleted,
      pedidoId: it.productionPedidoId,
      pedidoOp: it.pedidoOp,
      client: it.client,
      product: it.product,
      orderNumber: it.orderNumber,
      lote: it.lote,
    });
  }
  return out;
}

// ───────────────────────── «Visto» ─────────────────────────

const workScope = (id: string) => `WORK:${id}`;

async function loadSeen(db: Db, actor: ObservationActor, scopes: readonly string[]): Promise<Map<string, Date>> {
  if (scopes.length === 0) return new Map();
  try {
    const rows = await db
      .select({ scope: productionObservationSeen.scope, seenAt: productionObservationSeen.seenAt })
      .from(productionObservationSeen)
      .where(and(eq(productionObservationSeen.userKey, userKey(actor)), inArray(productionObservationSeen.scope, [...scopes])));
    return new Map(rows.map((r) => [r.scope, r.seenAt]));
  } catch (e) {
    // Migración 0089 pendiente: las observaciones se leen igual (sin indicador de «vistas»).
    if (isMissingSchemaError(e)) return new Map();
    throw e;
  }
}

// ───────────────────────── API del servicio ─────────────────────────

export interface FeedQuery extends FeedFilters {
  from?: string | null;
  to?: string | null;
  limit?: number | null;
  offset?: number | null;
}
export interface FeedResult {
  items: ProductionObservation[];
  /** Total que cumple los filtros (antes de paginar). */
  total: number;
  /** Nuevas (desde la última visita al listado) dentro de lo visible, sin filtros. */
  news: number;
  seenAt: string | null;
  hasMore: boolean;
}

const dayStart = (s?: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00-03:00`) : null);

/** Listado cronológico (más recientes primero) de las observaciones de todos los sectores productivos que el actor puede ver. */
export async function getObservationFeed(actor: ObservationActor, q: FeedQuery = {}): Promise<FeedResult> {
  assertCanView(actor);
  const db = getDb();
  const now = new Date();
  const from = dayStart(q.from) ?? new Date(now.getTime() - DEFAULT_FEED_DAYS * 86_400_000);
  const to = q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? new Date(new Date(`${q.to}T00:00:00-03:00`).getTime() + 86_400_000) : null;
  const raws = dedupeObservations(await loadRawObservations(db, { from, to, limit: MAX_SOURCE_ROWS }));
  await markEdited(db, raws);
  const itemIds = [...new Set(raws.map((r) => r.workItemId))];
  let items = new Map<string, ItemRow>();
  let visible: ObservationCandidate[] = [];
  if (itemIds.length > 0) {
    if (isAdminObservationSector(sectorOf(actor))) {
      for (const it of await fetchItems(db, sql`${workItems.id} in (${uuidList(itemIds)})`)) items.set(it.id, it);
      visible = enrich(raws, items);
    } else {
      const { nodes, links } = await loadChainNodes(db, itemIds);
      items = nodes;
      const idx = chainIndex(buildChains([...nodes.values()], links));
      const sector = sectorOf(actor);
      const all = enrich(raws, items);
      visible = all.filter((o) => {
        const chain = (idx.get(o.workItemId) ?? [o.workItemId]).map((id) => nodes.get(id)).filter((n): n is ItemRow => Boolean(n));
        return o.sector === sector || canSeeChain(sector, chain);
      });
    }
  }
  const seen = (await loadSeen(db, actor, [FEED_SCOPE])).get(FEED_SCOPE) ?? null;
  const flagged = withNewFlag(visible, seen, now);
  const filtered = sortNewestFirst(applyFeedFilters(flagged, q));
  const limit = Math.min(Math.max(Number(q.limit ?? 100) || 100, 1), 300);
  const offset = Math.max(Number(q.offset ?? 0) || 0, 0);
  return {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
    news: countObservations(flagged).news,
    seenAt: seen ? seen.toISOString() : null,
    hasMore: offset + limit < filtered.length,
  };
}

export interface WorkObservationsResult {
  workItemId: string;
  /** Trabajos de la cadena (etapas y programaciones del mismo trabajo). */
  chain: Array<{ id: string; sector: string; sectorLabel: string; orderNumber: string | null; deleted: boolean }>;
  /** Historial cronológico (más antiguas primero), sin duplicados. */
  items: ProductionObservation[];
  total: number;
  news: number;
  anuladas: number;
  seenAt: string | null;
}

/** Observaciones de TODA la cadena del trabajo (etapas anteriores y posteriores), también si ya se entregó o salió de Pendientes. */
export async function getWorkObservations(actor: ObservationActor, workItemId: string): Promise<WorkObservationsResult> {
  assertCanView(actor);
  const id = norm(workItemId).toLowerCase();
  if (!UUID_RE.test(id)) throw new PlanningValidationError("Identificador de trabajo inválido.");
  const db = getDb();
  const { nodes, links } = await loadChainNodes(db, [id]);
  if (!nodes.has(id)) throw new PlanningNotFoundError("El trabajo no existe.");
  const idx = chainIndex(buildChains([...nodes.values()], links));
  const chainIds = idx.get(id) ?? [id];
  const chainNodes = chainIds.map((c) => nodes.get(c)!).filter(Boolean);
  const raws = dedupeObservations(await loadRawObservations(db, { workItemIds: chainIds, limit: MAX_SOURCE_ROWS }));
  await markEdited(db, raws);
  const sector = sectorOf(actor);
  const candidates = enrich(raws, nodes);
  if (!isAdminObservationSector(sector) && !canSeeChain(sector, chainNodes) && !candidates.some((o) => o.sector === sector)) {
    throw new PlanningForbiddenError("No tenés permiso para ver las observaciones de este trabajo: no pertenece a tu sector.");
  }
  const seen = (await loadSeen(db, actor, [workScope(id)])).get(workScope(id)) ?? null;
  const items = sortChronological(withNewFlag(candidates, seen));
  const c = countObservations(items);
  return {
    workItemId: id,
    chain: chainNodes.map((n) => ({ id: n.id, sector: n.sector, sectorLabel: sectorLabel(n.sector), orderNumber: n.orderNumber, deleted: n.deleted })),
    items,
    total: c.total,
    news: c.news,
    anuladas: c.anuladas,
    seenAt: seen ? seen.toISOString() : null,
  };
}

/** Cantidad de observaciones y de nuevas por trabajo (para «Observaciones (N)» en las tarjetas), en una sola consulta. Omite los trabajos que el actor no puede ver. */
export async function getObservationSummary(actor: ObservationActor, workItemIds: readonly string[]): Promise<Record<string, { total: number; news: number }>> {
  assertCanView(actor);
  const ids = [...new Set(workItemIds.map((x) => norm(x).toLowerCase()).filter((x) => UUID_RE.test(x)))].slice(0, 80);
  if (ids.length === 0) return {};
  const db = getDb();
  const { nodes, links } = await loadChainNodes(db, ids);
  const idx = chainIndex(buildChains([...nodes.values()], links));
  const allChainIds = [...new Set(ids.flatMap((i) => idx.get(i) ?? [i]))];
  const raws = dedupeObservations(await loadRawObservations(db, { workItemIds: allChainIds, limit: MAX_SOURCE_ROWS }));
  const cands = enrich(raws, nodes);
  const seenMap = await loadSeen(db, actor, ids.map(workScope));
  const sector = sectorOf(actor);
  const out: Record<string, { total: number; news: number }> = {};
  for (const id of ids) {
    if (!nodes.has(id)) continue;
    const chainIds = new Set(idx.get(id) ?? [id]);
    const chainNodes = [...chainIds].map((c) => nodes.get(c)).filter((n): n is ItemRow => Boolean(n));
    const mine = cands.filter((o) => chainIds.has(o.workItemId));
    if (!isAdminObservationSector(sector) && !canSeeChain(sector, chainNodes) && !mine.some((o) => o.sector === sector)) continue;
    const c = countObservations(withNewFlag(mine, seenMap.get(workScope(id)) ?? null));
    out[id] = { total: c.total, news: c.news };
  }
  return out;
}

/** Marca como vistas las observaciones del ámbito («FEED» o id de trabajo) para el usuario. Es lo único que escribe este módulo. */
export async function markObservationsSeen(actor: ObservationActor, scope: string): Promise<{ scope: string; seenAt: string }> {
  assertCanView(actor);
  const raw = String(scope ?? "").trim();
  let key: string;
  if (raw.toUpperCase() === FEED_SCOPE) key = FEED_SCOPE;
  else {
    const id = norm(raw).toLowerCase();
    if (!UUID_RE.test(id)) throw new PlanningValidationError("Ámbito inválido.");
    // Mismo permiso que para leerlas: no se registra «visto» de un trabajo ajeno.
    await getWorkObservations(actor, id);
    key = workScope(id);
  }
  const now = new Date();
  await getDb()
    .insert(productionObservationSeen)
    .values({ userKey: userKey(actor), scope: key, seenAt: now })
    .onConflictDoUpdate({ target: [productionObservationSeen.userKey, productionObservationSeen.scope], set: { seenAt: sql`greatest(${productionObservationSeen.seenAt}, excluded.seen_at)` } });
  return { scope: key, seenAt: now.toISOString() };
}

export type { ObservationOrigin, ProductionObservation };
