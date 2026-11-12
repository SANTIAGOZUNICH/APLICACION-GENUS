/**
 * Remitos de ENTREGAS (renglones de entrega a Producción): cuánto de cada entrega ya figura en remitos vigentes y cuánto queda disponible.
 *
 * Conceptos que NO se mezclan:
 *  - Entrega interna (Envasado/Codificado → Producción, o Envasado → Codificado): movimiento interno entre sectores.
 *  - Recepción por Producción: la entrega a Producción registrada (renglón de entrega, estado ACTIVA).
 *  - Remito: documento (BORRADOR / GENERADO vigentes; ANULADO no cuenta). Una entrega puede estar en varios remitos, por partes.
 *  - Despacho físico al cliente: el remito NO mueve stock ni genera salidas; anularlo solo libera las unidades para remitir de nuevo.
 *
 * Fuente de verdad: los renglones de remito vinculados a la entrega por su clave `dl:<id de entrega>[:<token>]` (remito_lines.work_item_id)
 * de remitos NO anulados. No se guarda un segundo contador: nada puede quedar desfasado. La validación «no remitir dos veces las mismas
 * unidades» corre dentro de un candado por entrega (withAdvisoryLocks), así dos usuarios simultáneos no pueden pasarse del saldo.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured, remitoLineLockKey, withAdvisoryLocks } from "@/lib/db/client";
import { OrdersValidationError } from "@/lib/orders/types";
import { isIntegerUnit } from "@/lib/utils/ar-number-parsing";
import { describeDeliveryPacking, validateDeliveryPacking, type DeliveryPackingGroup } from "./delivery-packing";
import { mergePackingGroups, packingTotals } from "./delivery-boxes-input";
import { marksTableReady } from "./delivery-marks";
import { loadResolvedPackingByLine } from "./delivery-packing-resolve";
import { packingGroupsToRemitoSlots } from "./packing-math";
import { getRemitoService, type RemitoActor } from "./remito-service";
import type { RemitoApprovalInput, RemitoRecord } from "./types";

type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Exec = { execute: (q: any) => Promise<{ rows: unknown[] }> };

const EPS = 1e-6;
const fmt = (n: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(n);

/** Clave de vínculo remito ↔ entrega. La primera/única remitada por completo conserva la clave histórica `dl:<id>`. */
export const deliveryKey = (lineId: string, token?: string | null) => (token ? `dl:${lineId}:${token}` : `dl:${lineId}`);

export type RemitoRef = { id: string; number: string | null; status: string; units: number; key: string };
export type LineRemittance = {
  /** Unidades de la entrega que ya figuran en remitos vigentes (no anulados). */
  remitted: number;
  remitos: RemitoRef[];
  /** Marca manual: EXCLUIDA (quitada de pendientes) o REMITO_EXTERNO (ya remitada fuera de GENUS OS): no se ofrece a remitir. */
  mark: "EXCLUIDA" | "REMITO_EXTERNO" | null;
};

/** Remitos vigentes (y marcas) de las entregas indicadas. Una sola consulta por tipo; sin remitos → mapa con ceros. */
export async function loadRemittanceByLine(lineIds: string[], exec: Exec = getDb()): Promise<Map<string, LineRemittance>> {
  const ids = [...new Set(lineIds.filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
  const out = new Map<string, LineRemittance>(ids.map((i) => [i, { remitted: 0, remitos: [], mark: null }]));
  if (ids.length === 0) return out;
  const list = sql.join(ids.map((i) => sql`${i}`), sql`, `);
  try {
    const res = await exec.execute(sql`
      select substring(rl.work_item_id from 4 for 36) as line_id, rl.work_item_id as key, rl.total_units::float8 as units,
             r.id::text as remito_id, r.remito_number, r.status
        from remito_lines rl join remitos r on r.id = rl.remito_id
       where rl.work_item_id like 'dl:%' and r.status <> 'ANULADO' and substring(rl.work_item_id from 4 for 36) in (${list})`);
    for (const r of res.rows as Row[]) {
      const cur = out.get(String(r.line_id));
      if (!cur) continue;
      const units = Number(r.units) || 0;
      cur.remitted += units;
      cur.remitos.push({ id: String(r.remito_id), number: r.remito_number == null ? null : String(r.remito_number), status: String(r.status), units, key: String(r.key) });
    }
  } catch {
    // remitos aún no migrados: nada está remitido
  }
  try {
    if (await marksTableReady()) {
      const m = await exec.execute(sql`select delivery_line_id::text as id, mark from delivery_remito_marks where active = true and delivery_line_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
      for (const r of m.rows as Row[]) {
        const cur = out.get(String(r.id));
        if (cur) cur.mark = r.mark === "REMITO_EXTERNO" ? "REMITO_EXTERNO" : "EXCLUIDA";
      }
    }
  } catch {
    // marcas no disponibles
  }
  return out;
}

/** Unidades todavía disponibles para remitir de una entrega de `delivered` unidades (nunca negativo). */
export function availableToRemit(delivered: number, r: Pick<LineRemittance, "remitted" | "mark">): number {
  if (r.mark) return 0;
  return Math.max(0, delivered - r.remitted) < EPS ? 0 : Math.max(0, delivered - r.remitted);
}

const remitoLabel = (r: RemitoRef) => `${r.number ?? "(borrador)"} (${r.status === "GENERADO" ? "emitido" : r.status.toLowerCase()})`;

/**
 * ¿Se puede corregir (editar/cancelar) una entrega que ya figura en remitos? Un remito vigente NO puede quedar vinculado a una entrega
 * distinta de lo que remitió: mientras haya remitos vigentes no se cancela, no se baja la cantidad por debajo de lo remitido ni se
 * cambian las cajas; primero se anula o reemplaza el remito (con su propia trazabilidad). Subir la cantidad o cambiar observaciones sí.
 */
export function remittedEditProblem(r: LineRemittance, change: { cancel: boolean; newQuantity: number | null; boxesChanged: boolean }): string | null {
  const refs = r.remitos.map(remitoLabel).join(", ");
  const fix = "Para corregirla, primero anulá o reemplazá ese remito: el documento no se modifica en silencio.";
  if (r.mark === "REMITO_EXTERNO" && (change.cancel || change.boxesChanged || (change.newQuantity != null))) {
    return "Esta entrega está marcada como «remito ya creado» fuera de GENUS OS. Restaurala a pendientes antes de corregirla.";
  }
  if (r.remitted <= EPS) return null;
  if (change.cancel) return `No se puede cancelar: esta entrega ya figura en ${r.remitos.length === 1 ? "el remito" : "los remitos"} ${refs}. ${fix}`;
  if (change.newQuantity != null && change.newQuantity < r.remitted - EPS) {
    return `No se puede bajar la entrega a ${fmt(change.newQuantity)} u.: ${fmt(r.remitted)} u. ya figuran en ${r.remitos.length === 1 ? "el remito" : "los remitos"} ${refs}. ${fix}`;
  }
  if (change.boxesChanged) return `No se pueden cambiar las cajas: la entrega ya figura en ${r.remitos.length === 1 ? "el remito" : "los remitos"} ${refs}. ${fix}`;
  return null;
}

// ─────────────────────────── Lectura: entregas de un trabajo / elegibles ───────────────────────────

export type ReceivedDelivery = {
  deliveryLineId: string;
  workItemId: string;
  sequence: number;
  kind: "PARCIAL" | "FINAL";
  client: string;
  product: string;
  lote: string;
  vto: string;
  pedido: string | null;
  orderRef: string | null;
  sourceSector: string;
  deliveredAt: string;
  deliveryDate: string;
  deliveredBy: string;
  unit: string | null;
  /** Unidades entregadas a Producción en esta entrega. */
  delivered: number;
  /** Ya incluidas en remitos vigentes. */
  remitted: number;
  /** Disponibles para remitir ahora. */
  available: number;
  remitos: RemitoRef[];
  mark: "EXCLUIDA" | "REMITO_EXTERNO" | null;
  observations: string | null;
  packingGroups: DeliveryPackingGroup[];
  /** Cajas efectivas: propias de la entrega o (Codificado → Producción) las informadas por Envasado. */
  packingSource: "ENTREGA" | "TRABAJO" | "SNAPSHOT" | "NINGUNA";
  packingWarning: string | null;
  packingSuggested: DeliveryPackingGroup[];
  boxesText: string | null;
  cajas: number;
};

const DELIVERY_SQL = sql`
  select l.id::text as id, l.work_item_id::text as work_item_id, l.sequence, l.quantity::float8 as quantity, l.unit, l.kind, l.source_sector,
         l.actual_delivered_at, l.packing_groups, l.observations, l.remito, l.delivered_by,
         w.client, w.product, w.packaging_lote, w.packaging_vto, w.order_number, d.pedido_op,
         (l.actual_delivered_at at time zone 'America/Argentina/Buenos_Aires')::date::text as delivery_date
    from work_item_delivery_lines l
    join work_items w on w.id = l.work_item_id
    left join work_item_deliveries d on d.id = l.delivery_id`;

async function hydrate(rows: Row[]): Promise<ReceivedDelivery[]> {
  if (rows.length === 0) return [];
  const rem = await loadRemittanceByLine(rows.map((r) => String(r.id)));
  const resolved = await loadResolvedPackingByLine(rows.map((r) => String(r.work_item_id)));
  return rows.map((r) => {
    const id = String(r.id);
    const delivered = Number(r.quantity);
    const re = rem.get(id) ?? { remitted: 0, remitos: [], mark: null };
    const rp = resolved.get(id);
    const own = Array.isArray(r.packing_groups) ? (r.packing_groups as Array<{ cajas?: number; unidadesPorCaja?: number }>).map((g) => ({ cajas: Number(g.cajas) || 0, unidadesPorCaja: Number(g.unidadesPorCaja) || 0 })).filter((g) => g.cajas > 0 && g.unidadesPorCaja > 0) : [];
    const groups = rp ? rp.groups : own;
    return {
      deliveryLineId: id,
      workItemId: String(r.work_item_id),
      sequence: Number(r.sequence),
      kind: r.kind === "FINAL" ? "FINAL" : "PARCIAL",
      client: String(r.client ?? ""),
      product: String(r.product ?? ""),
      lote: String(r.packaging_lote ?? ""),
      vto: String(r.packaging_vto ?? ""),
      pedido: r.pedido_op == null ? null : String(r.pedido_op),
      orderRef: r.order_number == null ? null : String(r.order_number),
      sourceSector: String(r.source_sector),
      deliveredAt: new Date(String(r.actual_delivered_at)).toISOString(),
      deliveryDate: String(r.delivery_date),
      deliveredBy: String(r.delivered_by ?? ""),
      unit: r.unit == null ? null : String(r.unit),
      delivered,
      remitted: re.remitted,
      available: availableToRemit(delivered, re),
      remitos: re.remitos,
      mark: re.mark,
      observations: r.observations == null ? null : String(r.observations),
      packingGroups: groups,
      packingSource: rp?.source ?? (groups.length > 0 ? "ENTREGA" : "NINGUNA"),
      packingWarning: rp?.warning ?? null,
      packingSuggested: rp?.suggested ?? [],
      boxesText: describeDeliveryPacking(groups),
      cajas: packingTotals(groups).cajas,
    };
  });
}

/** TODAS las entregas ACTIVAS a Producción de un trabajo (también las ya remitidas por completo), una por una, con su desglose y disponibilidad. */
export async function listDeliveriesOfWork(workItemId: string): Promise<{ deliveries: ReceivedDelivery[]; totals: { received: number; remitted: number; available: number; cajas: number } }> {
  if (!/^[0-9a-f-]{36}$/i.test(workItemId)) throw new OrdersValidationError("Trabajo inválido.");
  const res = await getDb().execute(sql`${DELIVERY_SQL} where l.status = 'ACTIVA' and l.work_item_id = ${workItemId}::uuid order by l.sequence, l.created_at`);
  const deliveries = await hydrate(res.rows as Row[]);
  const totals = {
    received: deliveries.reduce((s, d) => s + d.delivered, 0),
    remitted: deliveries.reduce((s, d) => s + (d.mark === "REMITO_EXTERNO" ? d.delivered : d.remitted), 0),
    available: deliveries.reduce((s, d) => s + d.available, 0),
    cajas: packingTotals(mergePackingGroups(deliveries.map((d) => d.packingGroups))).cajas,
  };
  return { deliveries, totals };
}

/** Entrega(s) por id (activas), con disponibilidad. */
export async function loadDeliveriesByIds(lineIds: string[]): Promise<ReceivedDelivery[]> {
  const ids = [...new Set(lineIds.filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
  if (ids.length === 0) return [];
  const res = await getDb().execute(sql`${DELIVERY_SQL} where l.status = 'ACTIVA' and w.deleted_at is null and l.id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) order by l.actual_delivered_at desc`);
  return hydrate(res.rows as Row[]);
}

/** Entregas con unidades todavía disponibles para remitir (las excluidas/ya remitidas en otro sistema no se ofrecen). */
export async function listAvailableDeliveries(opts: { lineIds?: string[] } = {}): Promise<ReceivedDelivery[]> {
  const only = opts.lineIds?.length ? sql`and l.id in (${sql.join(opts.lineIds.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).map((i) => sql`${i}::uuid`), sql`, `)})` : sql``;
  const res = await getDb().execute(sql`${DELIVERY_SQL} where l.status = 'ACTIVA' and w.deleted_at is null ${only} order by l.actual_delivered_at desc`);
  return (await hydrate(res.rows as Row[])).filter((d) => d.available > EPS);
}

// ─────────────────────────── Escritura: preparar remito de UNA entrega (total o por partes) ───────────────────────────

export type PrepareRemitoInput = {
  deliveryLineId: string;
  /** Unidades a remitir (omitir = todo lo disponible de la entrega). */
  quantity?: number | string | null;
  /** Cajas de lo que se remite. Omitir = las de la entrega si se remite TODO; si no, quedan sin informar (no se inventan ni se dividen). */
  packingGroups?: unknown;
  observations?: string | null;
  /** Clave estable de la operación (doble clic / reintento = el mismo remito). */
  requestId?: string | null;
};

export type PrepareRemitoResult = { remito: RemitoRecord; replayed: boolean; delivery: ReceivedDelivery; remitted: number; available: number };

/**
 * «Preparar remito» de UNA entrega: crea un remito BORRADOR propio (individual, no se funde con otro del mismo cliente y fecha) con los
 * datos ya registrados por Envasado/Codificado. Se puede remitir toda la entrega o una parte; el saldo se calcula en el servidor, dentro
 * de un candado por entrega: si dos usuarios piden las mismas unidades a la vez, el segundo se rechaza.
 */
export async function prepareRemitoFromDelivery(actor: RemitoActor, input: PrepareRemitoInput): Promise<PrepareRemitoResult> {
  const lineId = String(input.deliveryLineId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(lineId)) throw new OrdersValidationError("Entrega inválida.");
  const token = String(input.requestId ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 16) || randomUUID().replace(/-/g, "").slice(0, 12);
  return withAdvisoryLocks([remitoLineLockKey(lineId)], async () => {
    const [d] = await loadDeliveriesByIds([lineId]);
    if (!d) throw new OrdersValidationError("La entrega no existe, fue cancelada o su trabajo fue eliminado.");
    const service = getRemitoService();
    // Reintento con la misma clave: devuelve el remito ya creado (sin descontar dos veces).
    const existing = await service.findByWorkItemId(deliveryKey(lineId, token));
    if (existing && existing.status !== "ANULADO") return { remito: existing, replayed: true, delivery: d, remitted: d.remitted, available: d.available };
    if (d.mark) throw new OrdersValidationError(d.mark === "REMITO_EXTERNO" ? "Esta entrega está marcada como «remito ya creado» fuera de GENUS OS." : "Esta entrega fue quitada de pendientes de remito: restaurala primero.");
    if (d.available <= EPS) throw new OrdersValidationError(`Esta entrega ya figura completa en remitos vigentes (${fmt(d.remitted)} de ${fmt(d.delivered)} u.).`);
    const unit = d.unit ?? "";
    const raw = input.quantity == null || input.quantity === "" ? d.available : Number(String(input.quantity).replace(/\./g, "").replace(",", "."));
    const quantity = typeof input.quantity === "number" ? input.quantity : raw;
    if (!Number.isFinite(quantity) || quantity <= 0) throw new OrdersValidationError("Las unidades a remitir deben ser un número mayor que 0.");
    if (isIntegerUnit(unit) && !Number.isInteger(quantity)) throw new OrdersValidationError("Las unidades a remitir deben ser un número entero.");
    if (quantity > d.available + EPS) {
      throw new OrdersValidationError(`Solo quedan ${fmt(d.available)} u. disponibles para remitir de esta entrega (recibidas ${fmt(d.delivered)}, ya en remitos vigentes ${fmt(d.remitted)}).`);
    }
    // Cajas: las informadas (deben sumar lo remitido); si se remite TODA la entrega y no se informan, las de la entrega; si es una parte, quedan sin
    // informar para que Producción las complete — nunca se dividen cajas ni se inventa un embalaje.
    let groups: DeliveryPackingGroup[];
    if (input.packingGroups !== undefined) {
      const chk = validateDeliveryPacking(input.packingGroups ?? [], quantity);
      if (!chk.ok) throw new OrdersValidationError(chk.error);
      groups = chk.groups;
    } else if (Math.abs(quantity - d.delivered) <= EPS && d.remitted <= EPS) {
      // Si las cajas de la entrega no suman lo entregado (diferencia por conciliar), el borrador lleva las unidades reales y las cajas quedan
      // para completar antes de emitir: el remito no toma unidades «inventadas» de un desglose que no cierra.
      groups = Math.abs(packingTotals(d.packingGroups).unidades - quantity) <= EPS || d.packingGroups.length === 0 ? d.packingGroups : [];
    } else {
      groups = [];
    }
    const slots = packingGroupsToRemitoSlots(groups);
    const whole = Math.abs(quantity - d.delivered) <= EPS && d.remitted <= EPS;
    const approval: RemitoApprovalInput = {
      workItemId: whole ? deliveryKey(lineId) : deliveryKey(lineId, token),
      clientId: d.client,
      clientDisplay: d.client,
      deliveryDate: d.deliveryDate,
      product: d.product,
      lote: d.lote,
      vto: d.vto,
      totalUnits: quantity,
      cajas1: slots.cajas1, unidades1: slots.unidades1,
      cajas2: slots.cajas2, unidades2: slots.unidades2,
      cajas3: slots.cajas3, unidades3: slots.unidades3,
      extraCajas: slots.extraCajas,
      trace: { deliveryLineId: lineId, workItemId: d.workItemId, pedido: d.pedido, orderRef: d.orderRef, deliveryRemito: null, observations: [d.observations?.trim(), input.observations?.trim()].filter(Boolean).join(' · ') || null, deliverySequence: d.sequence, deliveredQuantity: d.delivered },
    };
    // Un remito ANULADO libera sus unidades: se suelta su vínculo viejo (la trazabilidad queda en el remito anulado) para poder volver a remitir.
    if (isDatabaseConfigured()) {
      await getDb().execute(sql`delete from remito_work_links k using remitos r where r.id = k.remito_id and r.status = 'ANULADO' and k.work_item_id = ${approval.workItemId}`);
    }
    const r = await service.upsertDraftFromApproval(actor, approval, { standalone: true });
    const remito = r.remito;
    const after = (await loadDeliveriesByIds([lineId]))[0] ?? d;
    return { remito, replayed: Boolean(r.duplicateWorkItem), delivery: after, remitted: after.remitted, available: after.available };
  });
}

/**
 * ¿Un BORRADOR editado dejó algún renglón de entrega por encima de lo disponible? (los renglones del propio remito no cuentan como «otros»).
 * Devuelve el mensaje del primer problema o null. Se llama dentro del candado de las entregas implicadas.
 */
export async function draftOverRemitProblem(remito: Pick<RemitoRecord, "id" | "lines">): Promise<string | null> {
  const lines = remito.lines.filter((l) => l.trace?.deliveryLineId);
  if (lines.length === 0 || !isDatabaseConfigured()) return null;
  const ids = [...new Set(lines.map((l) => String(l.trace!.deliveryLineId)))];
  const rem = await loadRemittanceByLine(ids);
  const deliveries = await loadDeliveriesByIds(ids);
  for (const id of ids) {
    const d = deliveries.find((x) => x.deliveryLineId === id);
    if (!d) continue;
    const re = rem.get(id);
    const others = (re?.remitos ?? []).filter((r) => r.id !== remito.id).reduce((s, r) => s + r.units, 0);
    const mine = lines.filter((l) => String(l.trace!.deliveryLineId) === id).reduce((s, l) => s + (Number(l.totalUnits) || 0), 0);
    if (mine + others > d.delivered + EPS) {
      return `El renglón de «${d.product}» remita ${fmt(mine)} u. pero la entrega solo tiene ${fmt(Math.max(0, d.delivered - others))} u. disponibles (recibidas ${fmt(d.delivered)}, en otros remitos ${fmt(others)}).`;
    }
  }
  return null;
}
