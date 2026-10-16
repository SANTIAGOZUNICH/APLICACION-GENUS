/**
 * Datos del portal: lee las tablas operativas de GENUS OS (SOLO LECTURA) para UN cliente del portal y arma su vista.
 *
 * Aislamiento: el cliente se resuelve por sus alias (nombres de GENUS OS asignados explícitamente a UN solo cliente del
 * portal; un nombre solo puede pertenecer a uno). Cada trabajo se compara con igualdad exacta de nombre normalizado, nunca
 * por parecido: así dos clientes jamás ven pedidos del otro.
 *
 * La confirmación de recepción es una constancia adicional: NO modifica stock, movimientos, consumos, lotes, cantidades
 * entregadas ni estados de producción (solo escribe en las tablas del portal y avisa a Producción).
 */
import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { clientKey, parseQuantity } from "@/lib/entregas/rules";
import { getDb } from "@/lib/db/client";
import { osNotifications } from "@/lib/db/schema";
import type { BusinessCalendarOptions } from "./business-days";
import { readyStableMinutes } from "./config";
import {
  buildOverview,
  type ConfirmationInfo,
  type PortalDeliveryView,
  type PortalOverviewData,
  type RawDeliveryRow,
  type RawEventRow,
  type RawWorkRow,
} from "./overview";
import type { PortalSession } from "./auth-service";
import { audit, isoOrNull, requireDb, str, PortalError, type Row, type SqlExec } from "./store";
import { hmac } from "./security";
import type { PortalWorkSector } from "./stage-rules";

const LIVE = sql`w.deleted_at is null and w.operational_cancelled_at is null and w.operational_status <> 'cancelado' and w.status::text <> 'CANCELADO'`;
const inList = (ids: string[]) => sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);

/** Excepciones por decreto cargadas por Producción (feriado extra o quitado). */
export async function loadCalendarOptions(db: SqlExec = requireDb()): Promise<BusinessCalendarOptions> {
  const rows = (await db.execute(sql`
    select to_char(holiday_date, 'YYYY-MM-DD') as d, name, action from portal_holiday_overrides where removed_at is null`)).rows as Row[];
  return {
    adjustments: {
      add: rows.filter((r) => r.action === "AGREGAR").map((r) => ({ date: String(r.d), name: String(r.name) })),
      remove: rows.filter((r) => r.action === "QUITAR").map((r) => String(r.d)),
    },
  };
}

/** Ids de trabajos vivos que pertenecen a los alias (nombres de GENUS OS) de un cliente del portal. */
export async function findClientWorkIds(db: SqlExec, clientId: string): Promise<string[]> {
  const aliases = (await db.execute(sql`select name_key from portal_client_aliases where client_id = ${clientId}::uuid and removed_at is null`)).rows as Row[];
  const keys = new Set(aliases.map((a) => String(a.name_key)));
  if (!keys.size) return [];
  const pairs = (await db.execute(sql`select w.id::text as id, w.client from work_items w where ${LIVE}`)).rows as Row[];
  return pairs.filter((p) => keys.has(clientKey(String(p.client ?? "")))).map((p) => String(p.id));
}

export type ClientFacts = { works: RawWorkRow[]; deliveries: RawDeliveryRow[]; events: RawEventRow[] };

/** Trae las filas operativas de esos trabajos. Lista blanca de columnas: nada confidencial se selecciona. */
export async function loadFacts(db: SqlExec, workIds: string[]): Promise<ClientFacts> {
  if (!workIds.length) return { works: [], deliveries: [], events: [] };
  const list = inList(workIds);
  const works = (await db.execute(sql`
    select w.id::text as id, w.client, w.product, w.sector::text as sector, w.operational_status, w.source, w.created_at, w.completed_at,
           w.progress_updated_at, w.sent_to_codificado_at, coalesce(w.via_codificado, false) as via_codificado, w.planned_quantity, w.unit,
           w.finished_qty, w.deliverable_units, w.packaging_total_units, w.production_pedido_id::text as pedido_id,
           p.op as pedido_op, p.producto as pedido_producto
      from work_items w
      left join production_pedidos p on p.id = w.production_pedido_id and p.deleted_at is null
     where w.id in (${list}) and ${LIVE}`)).rows as Row[];
  const events = (await db.execute(sql`
    select work_item_id::text as work_item_id, type, created_at from operational_events
     where work_item_id in (${list}) and type in ('ITEM_ASSIGNED', 'RECEIVED_FROM_ELABORACION')`)).rows as Row[];
  // Entregas FINALES al cliente vigentes (mismo criterio que el calendario interno de Entregas).
  const lines = (await db.execute(sql`
    select l.id::text as id, l.work_item_id::text as work_item_id, l.actual_delivered_at as at, l.quantity::float8 as quantity, coalesce(l.unit, d.unit) as unit
      from work_item_delivery_lines l
      left join work_item_deliveries d on d.id = l.delivery_id
     where l.work_item_id in (${list}) and l.status = 'ACTIVA' and (d.id is null or (d.status::text = 'ENTREGADO' and d.deleted_at is null))`)).rows as Row[];
  const legacy = (await db.execute(sql`
    select d.id::text as id, d.work_item_id::text as work_item_id, d.actual_delivered_at as at, d.quantity, d.unit
      from work_item_deliveries d
     where d.work_item_id in (${list}) and d.status::text = 'ENTREGADO' and d.deleted_at is null
       and not exists (select 1 from work_item_delivery_lines l2 where l2.delivery_id = d.id and l2.status = 'ACTIVA')`)).rows as Row[];

  return {
    works: works.map(
      (r): RawWorkRow => ({
        id: String(r.id),
        client: String(r.client ?? ""),
        product: String(r.product ?? ""),
        sector: String(r.sector) as PortalWorkSector,
        operationalStatus: String(r.operational_status ?? "pendiente"),
        source: str(r.source),
        createdAt: isoOrNull(r.created_at),
        completedAt: isoOrNull(r.completed_at),
        progressUpdatedAt: isoOrNull(r.progress_updated_at),
        sentToCodificadoAt: isoOrNull(r.sent_to_codificado_at),
        viaCodificado: Boolean(r.via_codificado),
        plannedQuantity: str(r.planned_quantity),
        unit: str(r.unit),
        finishedQty: str(r.finished_qty),
        deliverableUnits: r.deliverable_units == null ? null : Number(r.deliverable_units),
        packagingTotalUnits: r.packaging_total_units == null ? null : Number(r.packaging_total_units),
        productionPedidoId: str(r.pedido_id),
        pedidoOp: str(r.pedido_op),
        pedidoProducto: str(r.pedido_producto),
      })
    ),
    events: events.map((r): RawEventRow => ({ workItemId: String(r.work_item_id), type: String(r.type), at: isoOrNull(r.created_at)! })),
    deliveries: [
      ...lines.map((r): RawDeliveryRow => ({ key: `line:${r.id}`, workItemId: String(r.work_item_id), at: isoOrNull(r.at)!, quantity: r.quantity == null ? null : Number(r.quantity), unit: str(r.unit) })),
      ...legacy.map((r): RawDeliveryRow => {
        const q = parseQuantity(str(r.quantity));
        return { key: `delivery:${r.id}`, workItemId: String(r.work_item_id), at: isoOrNull(r.at)!, quantity: typeof q === "number" ? q : null, unit: str(r.unit) };
      }),
    ],
  };
}

async function loadConfirmations(db: SqlExec, clientId: string): Promise<Map<string, ConfirmationInfo>> {
  const rows = (await db.execute(sql`select delivery_key, confirmed_at, confirmed_by_email from portal_receipt_confirmations where client_id = ${clientId}::uuid`)).rows as Row[];
  return new Map(rows.map((r) => [String(r.delivery_key), { at: isoOrNull(r.confirmed_at)!, by: String(r.confirmed_by_email) }]));
}

export type LoadedOverview = { overview: PortalOverviewData; facts: ClientFacts };

export async function loadPortalOverview(clientId: string, now: Date = new Date(), db: SqlExec = requireDb()): Promise<LoadedOverview> {
  const ids = await findClientWorkIds(db, clientId);
  const [facts, confirmations, calendar] = await Promise.all([loadFacts(db, ids), loadConfirmations(db, clientId), loadCalendarOptions(db)]);
  const overview = buildOverview({ clientId, works: facts.works, deliveries: facts.deliveries, events: facts.events, confirmations, now, calendar, readyStableMinutes: readyStableMinutes() });
  return { overview, facts };
}

// ───────────────────────── Notificaciones del cliente ─────────────────────────

export type PortalNotificationView = { id: string; kind: string; title: string; body: string; createdAt: string; read: boolean };

export async function listNotifications(clientId: string, limit = 30): Promise<PortalNotificationView[]> {
  const rows = (await requireDb().execute(sql`
    select id::text, kind, title, body, created_at, read_at from portal_notifications where client_id = ${clientId}::uuid order by created_at desc limit ${limit}`)).rows as Row[];
  return rows.map((r) => ({ id: String(r.id), kind: String(r.kind), title: String(r.title), body: String(r.body), createdAt: isoOrNull(r.created_at)!, read: r.read_at != null }));
}

export async function markNotificationsRead(clientId: string): Promise<void> {
  await requireDb().execute(sql`update portal_notifications set read_at = now() where client_id = ${clientId}::uuid and read_at is null`);
}

// ───────────────────────── Confirmar recepción ─────────────────────────

function uuidFromKey(key: string): string {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export type ConfirmResult =
  | { ok: true; confirmation: { id: string; confirmedAt: string; deliveredAt: string; product: string; orderRef: string | null; quantity: number | null; unit: string | null } }
  | { ok: false; reason: "not_found" | "already_confirmed" };

/** Entrega vigente (lista blanca) de un cliente, buscada por su id opaco. */
async function findDelivery(db: SqlExec, clientId: string, opaqueId: string): Promise<{ raw: RawDeliveryRow; view: PortalDeliveryView } | null> {
  const { overview, facts } = await loadPortalOverview(clientId, new Date(), db);
  const view = overview.deliveries.find((d) => d.id === opaqueId);
  if (!view) return null;
  const raw = facts.deliveries.find((d) => hmac("delivery", `${clientId}:${d.key}`).slice(0, 24) === opaqueId);
  return raw ? { raw, view } : null;
}

export async function getReceiptPreview(session: PortalSession, opaqueId: string): Promise<PortalDeliveryView | null> {
  const found = await findDelivery(requireDb(), session.clientId, opaqueId);
  return found?.view ?? null;
}

/**
 * Confirma la recepción de UNA entrega final. Una sola vez por entrega (índice único). Guarda fecha y hora, el correo
 * autenticado, la entrega y la cantidad; audita; avisa a Producción. NO toca stock ni estados operativos.
 */
export async function confirmReceipt(session: PortalSession, opaqueId: string, ipHash: string | null): Promise<ConfirmResult> {
  const db = requireDb();
  const found = await findDelivery(db, session.clientId, opaqueId);
  if (!found) return { ok: false, reason: "not_found" };
  const { raw, view } = found;
  const id = randomUUID();
  const rows = (await db.execute(sql`
    insert into portal_receipt_confirmations (id, client_id, delivery_key, work_item_id, product, order_ref, quantity, unit, delivered_at, confirmed_by_email, session_id, ip_hash)
    values (${id}::uuid, ${session.clientId}::uuid, ${raw.key}, ${raw.workItemId}, ${view.product}, ${view.orderRef}, ${view.quantity == null ? "—" : String(view.quantity)}, ${view.unit},
            ${raw.at}::timestamptz, ${session.email}, ${session.id}::uuid, ${ipHash})
    on conflict (delivery_key) do nothing
    returning confirmed_at`)).rows as Row[];
  if (!rows[0]) return { ok: false, reason: "already_confirmed" };
  await audit(db, { clientId: session.clientId, type: "RECEPCION_CONFIRMADA", kind: "CLIENTE", actor: session.email, ipHash, detail: { product: view.product, orderRef: view.orderRef, quantity: view.quantity, deliveredAt: raw.at } });
  // Aviso a Producción por el mecanismo de avisos internos de GENUS OS (best-effort: nunca revierte la constancia).
  try {
    await getDb()
      .insert(osNotifications)
      .values({
        id: uuidFromKey(`portal-recepcion:${raw.key}`),
        kind: "PORTAL_RECEPCION",
        title: `Recepción confirmada — ${session.clientName}`,
        message: [`El cliente confirmó la recepción desde el Portal de Clientes.`, `Cliente: ${session.clientName}`, `Producto: ${view.product}`, view.orderRef ? `Pedido: ${view.orderRef}` : null, `Cantidad: ${view.quantity ?? "—"}${view.unit ? ` ${view.unit}` : ""}`, `Confirmó: ${session.email}`].filter(Boolean).join("\n"),
        sectors: ["PRODUCCION", "DIRECCION"],
        href: null,
        readBy: [],
        dismissedBy: [],
        deletedBy: [],
      })
      .onConflictDoNothing();
  } catch (err) {
    console.error("[portal] no se pudo avisar a Producción de la recepción (la constancia ya quedó guardada)", err);
  }
  return {
    ok: true,
    confirmation: { id, confirmedAt: isoOrNull(rows[0].confirmed_at)!, deliveredAt: raw.at, product: view.product, orderRef: view.orderRef, quantity: view.quantity, unit: view.unit },
  };
}

export { PortalError };
