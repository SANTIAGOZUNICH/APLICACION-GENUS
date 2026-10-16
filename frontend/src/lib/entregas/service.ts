import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { OrdersForbiddenError, OrdersNotFoundError, OrdersUnavailableError, OrdersValidationError } from "@/lib/orders/types";
import { applyWorkItemCellChanges } from "@/lib/planning/work-item-cells-service";
import type { WorkItemCellChange } from "@/lib/planning/work-item-cell-edit";
import {
  canManageEntregas,
  canViewEntregas,
  DELIVERY_SECTOR_LABEL,
  EntregasConflictError,
  isEntregasConsultaOperativa,
  type DeliveryHistoryEntry,
  type DeliverySector,
  type DeliverySuggestion,
  type EntregasDateAudit,
  type EntregasDateAuditCategory,
  type EntregasRecoveryStats,
  type DateReviewFlag,
  type ItemSector,
  type LinkedWork,
  type RealDelivery,
  type ScheduledDelivery,
  type ScheduledDeliveryItem,
  type WorkDivergence,
} from "./types";
import { buildDerivedDeliveries, computeRecoveryStats, toLinkedWork, workReviewFlags, type WorkFacts } from "./derive";
import {
  clientKey,
  computeWorkDivergences,
  deriveDeliveryStatus,
  deriveItemStatus,
  matchDeliveryCandidates,
  snapshotOf,
  validateDeliveryInput,
  validateReason,
  optionalReason,
  type CleanDelivery,
  type DeliveryInput,
} from "./rules";

export type EntregasActor = { email: string; sector: string; displayName?: string };

type Row = Record<string, unknown>;
type SqlTx = { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> };

const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const iso = (v: unknown): string => new Date(String(v)).toISOString();

function requireDb() {
  if (!isDatabaseConfigured()) {
    throw new OrdersUnavailableError("Entregas requiere la base de datos: no está configurada en este entorno.");
  }
  return getDb();
}

function assertView(actor: EntregasActor) {
  if (!canViewEntregas(actor.sector)) throw new OrdersForbiddenError("Tu sector no tiene acceso a Entregas.");
}
function assertManage(actor: EntregasActor) {
  if (!canManageEntregas(actor.sector)) throw new OrdersForbiddenError("Solo Producción puede crear, modificar o cancelar entregas.");
}

/** Auditoría en feature_audit_events (dominio «entregas»): quién, cuándo, qué y valores antes/después. */
async function audit(
  tx: SqlTx,
  actor: EntregasActor,
  event: { action: string; deliveryId: string; payload?: Record<string, unknown> }
): Promise<void> {
  await tx.execute(sql`
    insert into feature_audit_events (id, domain, action, actor_email, actor_sector, entity_id, idempotency_key, payload, created_at)
    values (${randomUUID()}::uuid, 'entregas', ${event.action}, ${actor.email}, ${actor.sector}, ${event.deliveryId}, null, ${JSON.stringify(event.payload ?? {})}::jsonb, now())
  `);
}

/** Zona de «hoy» y de la fecha real de entrega (un timestamptz se muestra como día calendario argentino). */
const TZ = "America/Argentina/Buenos_Aires";

/**
 * Datos de un trabajo para el calendario (lectura fresca de work_items) más sus entregas REALES (ENTREGADO, no eliminadas).
 * Alias `w` = work_items. La fecha real es la de la entrega (actual_delivered_at), nunca completed_at.
 */
const WORK_FACT_COLS = sql`
  w.id as work_id, w.client, w.product,
  case when w.sector = 'CODIFICADO' then coalesce(w.codificado_origin_sector, w.sector::text) else w.sector::text end as sector,
  w.line, coalesce(w.branch_owner, w.line) as responsible,
  to_char(w.planned_date, 'YYYY-MM-DD') as planned_date, to_char(w.planned_date_to, 'YYYY-MM-DD') as planned_date_to,
  w.planned_quantity, w.unit, to_char(w.delivery_date, 'YYYY-MM-DD') as delivery_date, w.packaging_lote, w.packaging_vto,
  w.operational_status, w.finished_qty, w.deliverable_units, w.order_number,
  to_char(w.completed_at at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') as completed_on,
  nullif(concat_ws(' · ', nullif(trim(w.notes), ''), nullif(trim(w.operational_observation), '')), '') as notes,
  (w.deleted_at is not null or w.operational_cancelled_at is not null or w.operational_status = 'cancelado' or w.status = 'CANCELADO') as is_cancelled,
  (select coalesce(json_agg(x.j order by x.at, x.id), '[]'::json) from (
      -- Entregas PARCIALES (0047): cada envío físico es una línea con su propia fecha real. La fila agregada de
      -- work_item_deliveries guarda solo la ÚLTIMA fecha y el acumulado: leerla ubicaba todos los envíos en el día del último.
      select l.id, l.actual_delivered_at as at, json_build_object(
          'id', l.id, 'date', to_char(l.actual_delivered_at at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD'),
          'quantity', l.quantity::text, 'unit', coalesce(l.unit, wd.unit), 'remito', coalesce(l.remito, wd.remito),
          'receivedBy', coalesce(l.received_by, wd.received_by), 'lote', wd.lote, 'vto', wd.vto,
          'observations', coalesce(l.observations, wd.observations),
          'utcMidnight', (l.actual_delivered_at at time zone 'UTC')::time = time '00:00:00') as j
        from work_item_delivery_lines l join work_item_deliveries wd on wd.id = l.delivery_id
       where l.work_item_id = w.id and l.status = 'ACTIVA' and wd.status = 'ENTREGADO' and wd.deleted_at is null
      union all
      -- Entregas sin líneas (históricas, anteriores a 0047): la fila agregada es la única fuente.
      select wd.id, wd.actual_delivered_at as at, json_build_object(
          'id', wd.id, 'date', to_char(wd.actual_delivered_at at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD'),
          'quantity', wd.quantity, 'unit', wd.unit, 'remito', wd.remito, 'receivedBy', wd.received_by, 'lote', wd.lote, 'vto', wd.vto,
          'observations', wd.observations,
          'utcMidnight', (wd.actual_delivered_at at time zone 'UTC')::time = time '00:00:00') as j
        from work_item_deliveries wd
       where wd.work_item_id = w.id and wd.status = 'ENTREGADO' and wd.deleted_at is null
         and not exists (select 1 from work_item_delivery_lines l2 where l2.delivery_id = wd.id and l2.status = 'ACTIVA')
    ) x) as real_deliveries,
  (select json_build_object('reason', h.reason, 'by', h.hidden_by, 'at', h.hidden_at)
     from delivery_calendar_hidden h where h.work_item_id = w.id and h.restored_at is null limit 1) as calendar_hidden
`;

function parseRealDeliveries(raw: unknown): RealDelivery[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try { arr = JSON.parse(raw); } catch { arr = []; }
  }
  if (!Array.isArray(arr)) return [];
  return (arr as Row[]).map((d) => ({
    id: String(d.id),
    date: String(d.date),
    quantity: str(d.quantity),
    unit: str(d.unit),
    remito: str(d.remito),
    receivedBy: str(d.receivedBy),
    lote: str(d.lote),
    vto: str(d.vto),
    observations: str(d.observations),
    ...(d.utcMidnight === true || d.utcMidnight === "true" ? { utcMidnight: true } : {}),
  }));
}

function parseHidden(raw: unknown): WorkFacts["hidden"] {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try { v = JSON.parse(raw); } catch { v = null; }
  }
  if (!v || typeof v !== "object") return null;
  const h = v as Row;
  return { reason: String(h.reason ?? ""), by: String(h.by ?? ""), at: h.at ? iso(h.at) : "" };
}

/** Fila (WORK_FACT_COLS) → hechos del trabajo. Los campos de vínculo se completan aparte. */
function factsFromRow(r: Row): WorkFacts {
  const del = r.deliverable_units;
  return {
    workItemId: String(r.work_id),
    client: str(r.client),
    product: str(r.product),
    sector: String(r.sector),
    line: str(r.line),
    responsible: str(r.responsible),
    plannedDate: str(r.planned_date),
    plannedDateTo: str(r.planned_date_to),
    plannedQuantity: str(r.planned_quantity),
    unit: str(r.unit),
    deliveryDate: str(r.delivery_date),
    packagingLote: str(r.packaging_lote),
    packagingVto: str(r.packaging_vto),
    operationalStatus: String(r.operational_status ?? "pendiente"),
    finishedQty: str(r.finished_qty),
    deliverableUnits: del == null ? null : Number(del),
    orderNumber: str(r.order_number),
    notes: str(r.notes),
    completedAt: str(r.completed_on),
    realDeliveries: parseRealDeliveries(r.real_deliveries),
    cancelled: Boolean(r.is_cancelled),
    linked: Boolean(r.is_linked),
    containerDate: str(r.container_date),
    containerCancelled: r.container_status === "cancelada",
    hidden: parseHidden(r.calendar_hidden),
  };
}

const DELIVERY_COLS = sql`
  d.id, d.client, to_char(d.delivery_date, 'YYYY-MM-DD') as delivery_date, d.responsible, d.notes, d.status, d.reschedule_count,
  d.version, d.cancelled_at, d.cancelled_by, d.cancel_reason, d.created_by, d.created_at, d.updated_at
`;

/** Carga entregas (con productos y trabajos vinculados frescos) y deriva los estados. Sin recorte por sector. */
async function loadDeliveries(db: { execute: SqlTx["execute"] }, where: ReturnType<typeof sql>): Promise<ScheduledDelivery[]> {
  const dRows = (await db.execute(sql`select ${DELIVERY_COLS} from scheduled_deliveries d where ${where} order by d.delivery_date, d.client`)).rows as Row[];
  if (dRows.length === 0) return [];
  const ids = dRows.map((r) => String(r.id));
  const idList = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);

  const iRows = (await db.execute(sql`
    select i.id, i.delivery_id, i.product, i.quantity, i.unit, i.sector,
           to_char(i.planned_production_date, 'YYYY-MM-DD') as planned_production_date,
           i.lot, i.vto, i.notes, i.position, i.version, i.created_at, i.updated_at
    from scheduled_delivery_items i
    where i.delivery_id in (${idList}) and i.deleted_at is null
    order by i.position, i.created_at
  `)).rows as Row[];
  const itemIds = iRows.map((r) => String(r.id));

  let wRows: Row[] = [];
  if (itemIds.length) {
    const itemList = sql.join(itemIds.map((i) => sql`${i}::uuid`), sql`, `);
    wRows = (await db.execute(sql`
      select l.id as link_id, l.item_id, l.linked_at, l.linked_by, l.item_snapshot, true as is_linked, ${WORK_FACT_COLS}
      from scheduled_delivery_links l
      join work_items w on w.id = l.work_item_id
      where l.unlinked_at is null and l.item_id in (${itemList})
      order by l.linked_at
    `)).rows as Row[];
  }

  const worksByItem = new Map<string, LinkedWork[]>();
  for (const r of wRows) {
    const w = toLinkedWork(factsFromRow(r), {
      link: { linkId: String(r.link_id), linkedAt: iso(r.linked_at), linkedBy: String(r.linked_by), snapshot: (r.item_snapshot ?? {}) as LinkedWork["snapshot"] },
    });
    const k = String(r.item_id);
    worksByItem.set(k, [...(worksByItem.get(k) ?? []), w]);
  }

  const dateById = new Map(dRows.map((r) => [String(r.id), String(r.delivery_date)]));
  const itemsByDelivery = new Map<string, ScheduledDeliveryItem[]>();
  for (const r of iRows) {
    const item: ScheduledDeliveryItem = {
      id: String(r.id),
      deliveryId: String(r.delivery_id),
      product: String(r.product),
      quantity: str(r.quantity),
      unit: str(r.unit),
      sector: (str(r.sector) as ItemSector | null) ?? null,
      plannedProductionDate: str(r.planned_production_date),
      lot: str(r.lot),
      vto: str(r.vto),
      notes: str(r.notes),
      position: Number(r.position ?? 0),
      version: Number(r.version ?? 1),
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
      works: worksByItem.get(String(r.id)) ?? [],
      status: "programada",
    };
    item.status = deriveItemStatus(item);
    // Fechas contradictorias de sus trabajos (se marcan para Producción; nunca se corrigen solas).
    const flags = new Set<DateReviewFlag>();
    for (const w of item.works) {
      if (w.cancelled) continue;
      for (const f of workReviewFlags(w, { containerDate: dateById.get(String(r.delivery_id)) ?? null, delivered: w.delivered })) flags.add(f);
    }
    if (flags.size) item.reviewFlags = [...flags];
    const k = String(r.delivery_id);
    itemsByDelivery.set(k, [...(itemsByDelivery.get(k) ?? []), item]);
  }

  return dRows.map((r) => {
    const d: ScheduledDelivery = {
      id: String(r.id),
      client: String(r.client),
      deliveryDate: String(r.delivery_date),
      responsible: str(r.responsible),
      notes: str(r.notes),
      state: r.status === "cancelada" ? "cancelada" : "programada",
      rescheduleCount: Number(r.reschedule_count ?? 0),
      version: Number(r.version ?? 1),
      cancelledAt: r.cancelled_at ? iso(r.cancelled_at) : null,
      cancelledBy: str(r.cancelled_by),
      cancelReason: str(r.cancel_reason),
      createdBy: String(r.created_by),
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
      items: itemsByDelivery.get(String(r.id)) ?? [],
      status: "programada",
    };
    d.status = deriveDeliveryStatus(d);
    return d;
  });
}

const NOT_CANCELLED_WORK = sql`w.deleted_at is null and w.operational_cancelled_at is null and w.operational_status <> 'cancelado' and w.status <> 'CANCELADO'`;
const NOT_LINKED = sql`not exists (select 1 from scheduled_delivery_links l where l.work_item_id = w.id and l.unlinked_at is null)`;
const HAS_REAL_DELIVERY = sql`exists (select 1 from work_item_deliveries wd where wd.work_item_id = w.id and wd.status = 'ENTREGADO' and wd.deleted_at is null)`;

/**
 * Trabajos SIN vínculo activo que tienen algo para mostrar en [from, to]: una entrega real con fecha real en el rango
 * o (si siguen vigentes) su fecha de entrega programada en el rango. Los vinculados no se traen: su contenedor ya los muestra.
 */
async function loadUnlinkedWorks(db: { execute: SqlTx["execute"] }, from: string, to: string): Promise<WorkFacts[]> {
  const rows = (await db.execute(sql`
    select ${WORK_FACT_COLS}, false as is_linked, null::text as container_date, null::text as container_status
    from work_items w
    where ${NOT_LINKED} and (
      (w.delivery_date between ${from}::date and ${to}::date and ${NOT_CANCELLED_WORK})
      or exists (
        select 1 from work_item_delivery_lines l join work_item_deliveries wd on wd.id = l.delivery_id
        where l.work_item_id = w.id and l.status = 'ACTIVA' and wd.status = 'ENTREGADO' and wd.deleted_at is null
          and (l.actual_delivered_at at time zone ${TZ})::date between ${from}::date and ${to}::date
      )
      or exists (
        select 1 from work_item_deliveries wd
        where wd.work_item_id = w.id and wd.status = 'ENTREGADO' and wd.deleted_at is null
          and not exists (select 1 from work_item_delivery_lines l2 where l2.delivery_id = wd.id and l2.status = 'ACTIVA')
          and (wd.actual_delivered_at at time zone ${TZ})::date between ${from}::date and ${to}::date
      )
    )
  `)).rows as Row[];
  return rows.map(factsFromRow);
}

/**
 * Diagnóstico de solo lectura (no escribe nada): cuántas entregas HISTÓRICAS y FUTURAS se recuperan solas de los trabajos y
 * cuántos trabajos quedan fuera del calendario (sin fecha real / sin fecha de entrega / cancelados) y por qué.
 */
export async function entregasRecoveryStats(): Promise<EntregasRecoveryStats> {
  const db = requireDb();
  const rows = (await db.execute(sql`
    select ${WORK_FACT_COLS}, (lk.delivery_id is not null) as is_linked,
           to_char(d.delivery_date, 'YYYY-MM-DD') as container_date, d.status as container_status,
           to_char(now() at time zone ${TZ}, 'YYYY-MM-DD') as today
    from work_items w
    left join lateral (
      select i.delivery_id from scheduled_delivery_links l join scheduled_delivery_items i on i.id = l.item_id
      where l.work_item_id = w.id and l.unlinked_at is null limit 1
    ) lk on true
    left join scheduled_deliveries d on d.id = lk.delivery_id
    where w.delivery_date is not null or w.operational_status = 'entregado' or ${HAS_REAL_DELIVERY}
  `)).rows as Row[];
  const noDate = (await db.execute(sql`
    select count(*)::int as n, to_char(now() at time zone ${TZ}, 'YYYY-MM-DD') as today
    from work_items w
    where w.delivery_date is null and ${NOT_CANCELLED_WORK} and w.operational_status <> 'entregado'
      and ${NOT_LINKED} and not ${HAS_REAL_DELIVERY}
  `)).rows as Row[];
  const today = String(noDate[0]?.today ?? rows[0]?.today ?? new Date().toISOString().slice(0, 10));
  return computeRecoveryStats(rows.map(factsFromRow), today, Number(noDate[0]?.n ?? 0));
}

/**
 * Auditoría de fechas (SOLO LECTURA: no escribe ni corrige nada). Cada categoría trae la cantidad de casos y hasta 50
 * ejemplos. Las fechas contradictorias que no se pueden resolver con certeza quedan marcadas en el calendario
 * («Revisar fecha») para que Producción decida.
 */
export async function entregasDateAudit(): Promise<EntregasDateAudit> {
  const db = requireDb();
  const LIMIT = 50;
  const ar = (col: string) => sql.raw(`to_char(${col} at time zone '${TZ}', 'YYYY-MM-DD')`);
  const run = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as Row[];
  const category = (
    key: EntregasDateAuditCategory["key"],
    label: string,
    explanation: string,
    rows: Row[]
  ): EntregasDateAuditCategory => ({
    key,
    label,
    explanation,
    count: Number(rows[0]?.total ?? 0),
    samples: rows.map((r) => ({ workItemId: String(r.id), client: str(r.client), product: str(r.product), detail: String(r.detail ?? "") })),
  });

  const parciales = await run(sql`
    select w.id, w.client, w.product, count(*) over () as total,
           string_agg(distinct ${ar("l.actual_delivered_at")}, ', ') as detail
    from work_items w join work_item_delivery_lines l on l.work_item_id = w.id and l.status = 'ACTIVA'
    group by w.id, w.client, w.product
    having count(distinct ${ar("l.actual_delivered_at")}) > 1
    order by w.id limit ${LIMIT}
  `);
  const medianoche = await run(sql`
    select w.id, w.client, w.product, count(*) over () as total,
           'Entregado ' || to_char(x.at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC = ' || ${ar("x.at")} || ' en Argentina' as detail
    from work_items w
    join (
      select l.work_item_id, l.actual_delivered_at as at from work_item_delivery_lines l where l.status = 'ACTIVA'
      union all
      select wd.work_item_id, wd.actual_delivered_at from work_item_deliveries wd
      where wd.status = 'ENTREGADO' and wd.deleted_at is null
        and not exists (select 1 from work_item_delivery_lines l2 where l2.delivery_id = wd.id and l2.status = 'ACTIVA')
    ) x on x.work_item_id = w.id
    where (x.at at time zone 'UTC')::time = time '00:00:00'
    order by x.at desc limit ${LIMIT}
  `);
  const antes = await run(sql`
    select w.id, w.client, w.product, count(*) over () as total,
           'Entrega ' || to_char(w.delivery_date, 'YYYY-MM-DD') || ' · producción ' || to_char(w.planned_date, 'YYYY-MM-DD') as detail
    from work_items w
    where w.delivery_date is not null and w.planned_date is not null and w.delivery_date < w.planned_date and ${NOT_CANCELLED_WORK}
    order by w.delivery_date desc limit ${LIMIT}
  `);
  const otraFecha = await run(sql`
    select w.id, w.client, w.product, count(*) over () as total,
           'Trabajo ' || to_char(w.delivery_date, 'YYYY-MM-DD') || ' · entrega programada ' || to_char(d.delivery_date, 'YYYY-MM-DD') as detail
    from scheduled_delivery_links l
    join scheduled_delivery_items i on i.id = l.item_id and i.deleted_at is null
    join scheduled_deliveries d on d.id = i.delivery_id and d.status = 'programada'
    join work_items w on w.id = l.work_item_id
    where l.unlinked_at is null and w.delivery_date is not null and w.delivery_date <> d.delivery_date
      and ${NOT_CANCELLED_WORK} and w.operational_status <> 'entregado'
    order by d.delivery_date desc limit ${LIMIT}
  `);
  const sinFecha = await run(sql`
    select w.id, w.client, w.product, count(*) over () as total, 'Estado entregado sin entrega real registrada' as detail
    from work_items w
    where w.operational_status = 'entregado' and ${NOT_CANCELLED_WORK} and not ${HAS_REAL_DELIVERY}
    order by w.updated_at desc limit ${LIMIT}
  `);
  const today = String(((await run(sql`select to_char(now() at time zone ${TZ}, 'YYYY-MM-DD') as t`))[0]?.t) ?? "");
  return {
    generatedAt: new Date().toISOString(),
    today,
    categories: [
      category(
        "parciales_en_un_solo_dia",
        "Entregas parciales en distintos días",
        "La fila resumen de la entrega guarda solo la fecha del ÚLTIMO envío: el calendario mostraba todos los envíos ese día. Corregido: ahora cada envío aparece en su fecha real.",
        parciales
      ),
      category(
        "entrega_hora_utc_medianoche",
        "Entregas guardadas a las 00:00 UTC",
        "Fecha cargada sin hora y guardada como medianoche UTC: en Argentina cae el día anterior. No se corrige sola: quedan marcadas «Revisar fecha».",
        medianoche
      ),
      category(
        "entrega_antes_de_produccion",
        "Fecha de entrega anterior a la de producción",
        "Fechas contradictorias del trabajo: quedan marcadas «Revisar fecha» para que Producción decida.",
        antes
      ),
      category(
        "trabajo_con_otra_fecha",
        "Trabajo vinculado con otra fecha",
        "El calendario muestra el trabajo en la fecha de su entrega programada (la decisión manual de Producción), pero el trabajo tiene otra fecha de entrega. Queda marcado «Revisar fecha».",
        otraFecha
      ),
      category(
        "entregado_sin_fecha_real",
        "Entregados sin entrega real registrada",
        "El trabajo figura entregado pero no tiene entrega real: no se ubica en el calendario (nunca se inventa una fecha).",
        sinFecha
      ),
    ],
  };
}

const isoDate = (v: string, label: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new OrdersValidationError(`${label} no es una fecha válida.`);
  return v;
};

/**
 * Agenda de entregas PENDIENTES: se ocultan los productos ya entregados por completo y las entregas sin nada pendiente
 * (siguen en la base, en Entregados, el historial y la auditoría). Las canceladas solo se listan con «Ver quitadas»
 * (para poder restaurarlas). Una entrega parcial queda, con su saldo pendiente en el detalle.
 */
function pendingAgenda(deliveries: ScheduledDelivery[], includeHidden: boolean): ScheduledDelivery[] {
  const out: ScheduledDelivery[] = [];
  for (const d of deliveries) {
    if (d.state === "cancelada") {
      if (includeHidden) out.push(d);
      continue;
    }
    const items = d.items.filter((it) => it.status !== "entregada");
    if (items.length === 0) continue;
    const next = { ...d, items };
    out.push({ ...next, status: deriveDeliveryStatus(next) });
  }
  return out;
}

export const entregasService = {
  /**
   * Entregas con fecha entre `from` y `to` (inclusive). Une, SIN copiar nada (se calcula en cada lectura, así que cualquier
   * cambio en un trabajo se ve al instante):
   *  - las entregas programadas a mano (incluye canceladas: se ven tachadas para conservar historial), y
   *  - lo recuperado de los trabajos NO vinculados: entregas reales en su fecha real («Entrega registrada») y trabajos
   *    vigentes con fecha de entrega («Desde trabajo»). Un trabajo vinculado ya aparece dentro de su entrega programada.
   */
  async list(actor: EntregasActor, range: { from: string; to: string }, opts: { includeHidden?: boolean } = {}): Promise<ScheduledDelivery[]> {
    assertView(actor);
    const db = requireDb();
    const from = isoDate(range.from, "Desde");
    const to = isoDate(range.to, "Hasta");
    const scheduled = await loadDeliveries(db, sql`d.delivery_date between ${from}::date and ${to}::date`);
    // Las apariciones quitadas por Producción solo se listan para quien puede restaurarlas.
    const includeHidden = Boolean(opts.includeHidden) && canManageEntregas(actor.sector);
    const derived = buildDerivedDeliveries(await loadUnlinkedWorks(db, from, to), { from, to }, { includeHidden });
    return [...pendingAgenda(scheduled, includeHidden), ...derived];
  },

  /** Diagnóstico de lo recuperado automáticamente. Envasado y Codificado consultan el calendario, sin estas cifras. */
  async recoveryStats(actor: EntregasActor): Promise<EntregasRecoveryStats | null> {
    assertView(actor);
    if (isEntregasConsultaOperativa(actor.sector)) return null;
    return entregasRecoveryStats();
  },

  async get(actor: EntregasActor, id: string): Promise<ScheduledDelivery> {
    assertView(actor);
    const db = requireDb();
    const [d] = await loadDeliveries(db, sql`d.id = ${id}::uuid`);
    if (!d) throw new OrdersNotFoundError("Entrega no encontrada.");
    return d;
  },

  async create(actor: EntregasActor, input: DeliveryInput): Promise<ScheduledDelivery> {
    assertManage(actor);
    const v = validateDeliveryInput(input);
    if (!v.ok) throw new OrdersValidationError(v.message);
    const db = requireDb();
    const c = v.value;
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        insert into scheduled_deliveries (id, client, client_key, delivery_date, responsible, notes, created_by, created_by_sector)
        values (${id}::uuid, ${c.client}, ${clientKey(c.client)}, ${c.deliveryDate}::date, ${c.responsible}, ${c.notes}, ${actor.email}, ${actor.sector})
      `);
      await insertItems(tx, id, c.items, 0);
      await audit(tx, actor, { action: "create", deliveryId: id, payload: { after: snapshot(c) } });
    });
    return this.get(actor, id);
  },

  /**
   * Modifica cliente, observaciones, responsable y productos (agregar / editar / quitar). La FECHA no se cambia acá:
   * se usa «Reprogramar», que exige motivo. Quitar un producto con trabajos vinculados no está permitido.
   * Versión optimista: si otra persona modificó la entrega, se rechaza (nunca se pisa).
   */
  async update(actor: EntregasActor, id: string, input: DeliveryInput, expectedVersion: number): Promise<ScheduledDelivery> {
    assertManage(actor);
    const v = validateDeliveryInput(input);
    if (!v.ok) throw new OrdersValidationError(v.message);
    const c = v.value;
    const db = requireDb();
    await db.transaction(async (tx) => {
      const cur = await lockDelivery(tx, id);
      if (cur.status === "cancelada") throw new EntregasConflictError("La entrega está cancelada: no se puede modificar.");
      if (Number(cur.version) !== expectedVersion) throw new EntregasConflictError("Otra persona modificó esta entrega. Recargá y volvé a aplicar tu cambio.");
      if (c.deliveryDate !== cur.delivery_date) throw new OrdersValidationError("Para cambiar la fecha usá «Reprogramar» (queda con motivo en el historial).");

      const before = await loadDeliveries(tx, sql`d.id = ${id}::uuid`);
      const beforeItems = before[0]?.items ?? [];
      const keep = new Map(beforeItems.map((i) => [i.id, i]));
      const incomingIds = new Set(c.items.flatMap((i) => (i.id ? [i.id] : [])));
      for (const i of c.items) {
        if (i.id && !keep.has(i.id)) throw new OrdersValidationError("Un producto ya no existe en esta entrega. Recargá.");
      }
      for (const old of beforeItems) {
        if (!incomingIds.has(old.id) && old.works.some((w) => !w.cancelled)) {
          throw new EntregasConflictError(`«${old.product}» tiene trabajos vinculados: desvinculalos antes de quitarlo.`);
        }
      }
      await tx.execute(sql`
        update scheduled_deliveries set client = ${c.client}, client_key = ${clientKey(c.client)}, responsible = ${c.responsible}, notes = ${c.notes},
          version = version + 1, updated_at = now() where id = ${id}::uuid
      `);
      // Productos: se quitan (baja lógica), se actualizan y se agregan.
      for (const old of beforeItems) {
        if (!incomingIds.has(old.id)) {
          await tx.execute(sql`update scheduled_delivery_items set deleted_at = now(), deleted_by = ${actor.email}, updated_at = now() where id = ${old.id}::uuid`);
        }
      }
      let position = 0;
      for (const i of c.items) {
        if (i.id) {
          await tx.execute(sql`
            update scheduled_delivery_items set product = ${i.product}, quantity = ${i.quantity}, unit = ${i.unit}, sector = ${i.sector},
              planned_production_date = ${i.plannedProductionDate}::date, lot = ${i.lot}, vto = ${i.vto}, notes = ${i.notes},
              position = ${position}, version = version + 1, updated_at = now()
            where id = ${i.id}::uuid and delivery_id = ${id}::uuid
          `);
        } else {
          await insertItems(tx, id, [i], position);
        }
        position += 1;
      }
      await audit(tx, actor, {
        action: "update",
        deliveryId: id,
        payload: { before: snapshotFromDelivery(before[0]!), after: snapshot(c) },
      });
    });
    return this.get(actor, id);
  },

  /** Reprograma la fecha de entrega. Motivo obligatorio y auditado; no toca los trabajos (se muestran las diferencias). */
  async reschedule(actor: EntregasActor, id: string, newDate: string, reason: unknown, expectedVersion: number): Promise<ScheduledDelivery> {
    assertManage(actor);
    const date = isoDate(newDate, "La nueva fecha");
    const r = optionalReason(reason);
    const db = requireDb();
    await db.transaction(async (tx) => {
      const cur = await lockDelivery(tx, id);
      if (cur.status === "cancelada") throw new EntregasConflictError("La entrega está cancelada: no se puede reprogramar.");
      if (Number(cur.version) !== expectedVersion) throw new EntregasConflictError("Otra persona modificó esta entrega. Recargá y volvé a aplicar tu cambio.");
      if (date === cur.delivery_date) throw new OrdersValidationError("La nueva fecha es igual a la actual.");
      await tx.execute(sql`
        update scheduled_deliveries set delivery_date = ${date}::date, reschedule_count = reschedule_count + 1, version = version + 1, updated_at = now()
        where id = ${id}::uuid
      `);
      await audit(tx, actor, { action: "reschedule", deliveryId: id, payload: { from: cur.delivery_date, to: date, reason: r.value } });
    });
    return this.get(actor, id);
  },

  /**
   * Cancela una entrega PROGRAMADA (queda como historial, nunca se borra). No es lo mismo que anular o eliminar una
   * entrega REAL: esas viven en «Entregados» y no se tocan. Los trabajos vinculados siguen su curso.
   */
  async cancel(actor: EntregasActor, id: string, reason: unknown, expectedVersion: number): Promise<ScheduledDelivery> {
    assertManage(actor);
    const r = validateReason(reason);
    if (!r.ok) throw new OrdersValidationError(r.message);
    const db = requireDb();
    await db.transaction(async (tx) => {
      const cur = await lockDelivery(tx, id);
      if (cur.status === "cancelada") return; // idempotente
      if (Number(cur.version) !== expectedVersion) throw new EntregasConflictError("Otra persona modificó esta entrega. Recargá y volvé a aplicar tu cambio.");
      await tx.execute(sql`
        update scheduled_deliveries set status = 'cancelada', cancelled_at = now(), cancelled_by = ${actor.email}, cancel_reason = ${r.value},
          version = version + 1, updated_at = now() where id = ${id}::uuid
      `);
      await audit(tx, actor, { action: "cancel", deliveryId: id, payload: { reason: r.value, previousDate: cur.delivery_date } });
    });
    return this.get(actor, id);
  },

  /** Vincula manualmente un trabajo existente con un producto de la entrega (Producción confirma). */
  async linkWork(actor: EntregasActor, itemId: string, workItemId: string): Promise<ScheduledDelivery> {
    assertManage(actor);
    const db = requireDb();
    let deliveryId = "";
    await db.transaction(async (tx) => {
      deliveryId = await linkWorkInTx(tx, actor, { itemId, workItemId, requireMatch: false });
    });
    return this.get(actor, deliveryId);
  },

  async unlinkWork(actor: EntregasActor, linkId: string, reason: unknown): Promise<ScheduledDelivery> {
    assertManage(actor);
    const r = validateReason(reason);
    if (!r.ok) throw new OrdersValidationError(r.message);
    const db = requireDb();
    let deliveryId = "";
    await db.transaction(async (tx) => {
      const res = (await tx.execute(sql`
        select l.id, l.item_id, l.work_item_id, l.unlinked_at, i.delivery_id
        from scheduled_delivery_links l join scheduled_delivery_items i on i.id = l.item_id
        where l.id = ${linkId}::uuid for update of l
      `)).rows as Row[];
      const row = res[0];
      if (!row) throw new OrdersNotFoundError("Vínculo no encontrado.");
      deliveryId = String(row.delivery_id);
      if (row.unlinked_at) return; // idempotente
      await tx.execute(sql`update scheduled_delivery_links set unlinked_at = now(), unlinked_by = ${actor.email}, unlink_reason = ${r.value} where id = ${linkId}::uuid`);
      await audit(tx, actor, { action: "unlink", deliveryId, payload: { itemId: String(row.item_id), workItemId: String(row.work_item_id), reason: r.value } });
    });
    return this.get(actor, deliveryId);
  },

  /** Entregas pendientes que coinciden con cliente + producto + sector (para «Asignar trabajo»). Nunca vincula solo. */
  async suggestions(actor: EntregasActor, criteria: { client: string; product: string; sector: string | null }): Promise<DeliverySuggestion[]> {
    assertManage(actor);
    const db = requireDb();
    if (!criteria.client.trim() || !criteria.product.trim()) return [];
    // Ventana: entregas desde hace 60 días en adelante (lo viejo sin trabajo ya no es candidato razonable).
    const all = await loadDeliveries(db, sql`d.status = 'programada' and d.delivery_date >= (current_date - interval '60 days')`);
    return matchDeliveryCandidates(all, criteria);
  },

  /** Diferencias entre lo programado y cada trabajo vinculado (solo lectura; se confirma antes de aplicar). */
  divergencesFor(delivery: ScheduledDelivery): Array<{ itemId: string; linkId: string; workItemId: string; divergences: WorkDivergence[] }> {
    const out: Array<{ itemId: string; linkId: string; workItemId: string; divergences: WorkDivergence[] }> = [];
    for (const it of delivery.items) {
      for (const w of it.works) {
        if (w.cancelled) continue;
        const divergences = computeWorkDivergences(delivery, it, w, it.works.filter((x) => !x.cancelled).length);
        if (divergences.length) out.push({ itemId: it.id, linkId: w.linkId, workItemId: w.workItemId, divergences });
      }
    }
    return out;
  },

  /**
   * Aplica al trabajo los cambios que Producción CONFIRMÓ (campos elegidos) usando la edición por celda canónica:
   * respeta protecciones, versión y motivo. Nunca toca la cantidad realizada ni los avances del operario.
   */
  async applyToWork(
    actor: EntregasActor,
    linkId: string,
    fields: string[],
    reason: unknown
  ): Promise<{ applied: string[]; delivery: ScheduledDelivery }> {
    assertManage(actor);
    const r = optionalReason(reason);
    const db = requireDb();
    const linkRows = (await db.execute(sql`
      select l.id, i.delivery_id, l.work_item_id from scheduled_delivery_links l join scheduled_delivery_items i on i.id = l.item_id
      where l.id = ${linkId}::uuid and l.unlinked_at is null
    `)).rows as Row[];
    const link = linkRows[0];
    if (!link) throw new OrdersNotFoundError("Vínculo no encontrado.");
    const deliveryId = String(link.delivery_id);
    const [delivery] = await loadDeliveries(db, sql`d.id = ${deliveryId}::uuid`);
    if (!delivery) throw new OrdersNotFoundError("Entrega no encontrada.");
    if (delivery.state === "cancelada") throw new EntregasConflictError("La entrega está cancelada.");
    const item = delivery.items.find((i) => i.works.some((w) => w.linkId === linkId));
    const work = item?.works.find((w) => w.linkId === linkId);
    if (!item || !work) throw new OrdersNotFoundError("Vínculo no encontrado.");

    const divergences = computeWorkDivergences(delivery, item, work, item.works.filter((x) => !x.cancelled).length);
    const chosen = divergences.filter((d) => fields.includes(d.field));
    if (chosen.length === 0) throw new OrdersValidationError("No hay diferencias para aplicar (puede que ya estén al día).");

    const versionRow = (await db.execute(sql`select version from work_items where id = ${work.workItemId}::uuid`)).rows as Row[];
    const version = Number(versionRow[0]?.version ?? 0);
    const changes: WorkItemCellChange[] = chosen.map((d) => ({
      id: `native:${work.workItemId}`,
      field: d.field,
      value: d.itemValue,
      expectedVersion: version,
      reason: r.value ? `Entrega programada ${delivery.client} (${delivery.deliveryDate}): ${r.value}` : undefined,
    }));
    const { results, ok } = await applyWorkItemCellChanges(
      { email: actor.email, sector: actor.sector, displayName: actor.displayName ?? actor.email },
      changes
    );
    if (!ok) {
      const first = results.find((x) => !x.ok) as { message?: string } | undefined;
      throw new EntregasConflictError(first?.message ?? "No se pudo aplicar el cambio al trabajo.");
    }
    await db.transaction(async (tx) => {
      await refreshSnapshot(tx, linkId, delivery, item, chosen.map((d) => d.field));
      await audit(tx, actor, {
        action: "apply_to_work",
        deliveryId,
        payload: { itemId: item.id, workItemId: work.workItemId, fields: chosen.map((d) => ({ field: d.field, from: d.workValue, to: d.itemValue })), reason: r.value },
      });
    });
    return { applied: chosen.map((d) => d.field), delivery: await this.get(actor, deliveryId) };
  },

  /**
   * Producción revisó las diferencias y decide MANTENER el trabajo como está: no se toca el trabajo, y esos cambios de la
   * entrega dejan de mostrarse como pendientes (queda auditado con motivo). Si la entrega vuelve a cambiar, vuelve a avisar.
   */
  async keepWorkAsIs(actor: EntregasActor, linkId: string, fields: string[], reason: unknown): Promise<ScheduledDelivery> {
    assertManage(actor);
    const r = optionalReason(reason);
    const db = requireDb();
    const rows = (await db.execute(sql`
      select i.delivery_id from scheduled_delivery_links l join scheduled_delivery_items i on i.id = l.item_id
      where l.id = ${linkId}::uuid and l.unlinked_at is null
    `)).rows as Row[];
    if (!rows[0]) throw new OrdersNotFoundError("Vínculo no encontrado.");
    const deliveryId = String(rows[0].delivery_id);
    const [delivery] = await loadDeliveries(db, sql`d.id = ${deliveryId}::uuid`);
    const item = delivery?.items.find((i) => i.works.some((w) => w.linkId === linkId));
    const work = item?.works.find((w) => w.linkId === linkId);
    if (!delivery || !item || !work) throw new OrdersNotFoundError("Vínculo no encontrado.");
    const chosen = computeWorkDivergences(delivery, item, work, item.works.filter((x) => !x.cancelled).length).filter((d) => fields.includes(d.field));
    if (chosen.length === 0) throw new OrdersValidationError("No hay diferencias para dar por revisadas.");
    await db.transaction(async (tx) => {
      await refreshSnapshot(tx, linkId, delivery, item, chosen.map((d) => d.field));
      await audit(tx, actor, {
        action: "keep_work_as_is",
        deliveryId,
        payload: { itemId: item.id, workItemId: work.workItemId, fields: chosen.map((d) => ({ field: d.field, from: d.workValue, to: d.itemValue })), reason: r.value },
      });
    });
    return this.get(actor, deliveryId);
  },

  /** Restaura una entrega programada CANCELADA (motivo obligatorio y auditado). Vuelve con sus productos y vínculos. */
  async restore(actor: EntregasActor, id: string, reason: unknown, expectedVersion: number): Promise<ScheduledDelivery> {
    assertManage(actor);
    const r = validateReason(reason);
    if (!r.ok) throw new OrdersValidationError(r.message);
    const db = requireDb();
    await db.transaction(async (tx) => {
      const cur = await lockDelivery(tx, id);
      if (cur.status !== "cancelada") throw new OrdersValidationError("La entrega no está cancelada.");
      if (Number(cur.version) !== expectedVersion) throw new EntregasConflictError("Otra persona modificó esta entrega. Recargá y volvé a aplicar tu cambio.");
      const prev = ((await tx.execute(sql`select cancelled_at, cancelled_by, cancel_reason from scheduled_deliveries where id = ${id}::uuid`)).rows as Row[])[0] ?? {};
      await tx.execute(sql`
        update scheduled_deliveries set status = 'programada', cancelled_at = null, cancelled_by = null, cancel_reason = null,
          version = version + 1, updated_at = now() where id = ${id}::uuid
      `);
      await audit(tx, actor, {
        action: "restore",
        deliveryId: id,
        payload: { reason: r.value, cancelledAt: prev.cancelled_at ? iso(prev.cancelled_at) : null, cancelledBy: str(prev.cancelled_by), cancelReason: str(prev.cancel_reason) },
      });
    });
    return this.get(actor, id);
  },

  /**
   * Cambia la fecha de UN producto sin mover los demás del mismo cliente: el producto (con sus trabajos vinculados) pasa a la
   * entrega programada del mismo cliente en la nueva fecha (se crea si no existe). Si es el único producto, se reprograma la
   * entrega entera. Motivo obligatorio; queda en el historial de las dos entregas.
   */
  async moveItem(
    actor: EntregasActor,
    deliveryId: string,
    itemId: string,
    newDate: string,
    reason: unknown,
    expectedVersion: number
  ): Promise<{ source: ScheduledDelivery; target: ScheduledDelivery }> {
    assertManage(actor);
    const date = isoDate(newDate, "La nueva fecha");
    const r = optionalReason(reason);
    const db = requireDb();
    let targetId = deliveryId;
    await db.transaction(async (tx) => {
      const cur = await lockDelivery(tx, deliveryId);
      if (cur.status === "cancelada") throw new EntregasConflictError("La entrega está cancelada: no se puede reprogramar.");
      if (Number(cur.version) !== expectedVersion) throw new EntregasConflictError("Otra persona modificó esta entrega. Recargá y volvé a aplicar tu cambio.");
      if (date === cur.delivery_date) throw new OrdersValidationError("La nueva fecha es igual a la actual.");
      const items = (await tx.execute(sql`
        select id, product from scheduled_delivery_items where delivery_id = ${deliveryId}::uuid and deleted_at is null order by position
      `)).rows as Row[];
      const item = items.find((i) => String(i.id) === itemId);
      if (!item) throw new OrdersNotFoundError("El producto ya no está en esta entrega. Recargá.");
      if (items.length === 1) {
        // Único producto: es la entrega entera.
        await tx.execute(sql`
          update scheduled_deliveries set delivery_date = ${date}::date, reschedule_count = reschedule_count + 1, version = version + 1, updated_at = now()
          where id = ${deliveryId}::uuid
        `);
        await audit(tx, actor, { action: "reschedule", deliveryId, payload: { from: cur.delivery_date, to: date, reason: r.value, itemId, product: String(item.product) } });
        return;
      }
      const head = ((await tx.execute(sql`select client, client_key, responsible from scheduled_deliveries where id = ${deliveryId}::uuid`)).rows as Row[])[0]!;
      const existing = ((await tx.execute(sql`
        select id from scheduled_deliveries
        where client_key = ${String(head.client_key)} and delivery_date = ${date}::date and status = 'programada' and id <> ${deliveryId}::uuid
        order by created_at limit 1 for update
      `)).rows as Row[])[0];
      if (existing) {
        targetId = String(existing.id);
        await tx.execute(sql`update scheduled_deliveries set version = version + 1, updated_at = now() where id = ${targetId}::uuid`);
      } else {
        targetId = randomUUID();
        await tx.execute(sql`
          insert into scheduled_deliveries (id, client, client_key, delivery_date, responsible, notes, created_by, created_by_sector)
          values (${targetId}::uuid, ${String(head.client)}, ${String(head.client_key)}, ${date}::date, ${str(head.responsible)}, null, ${actor.email}, ${actor.sector})
        `);
        await audit(tx, actor, { action: "create", deliveryId: targetId, payload: { origin: "move_item", sourceDeliveryId: deliveryId, reason: r.value } });
      }
      const pos = ((await tx.execute(sql`
        select coalesce(max(position) + 1, 0) as p from scheduled_delivery_items where delivery_id = ${targetId}::uuid and deleted_at is null
      `)).rows as Row[])[0]?.p;
      await tx.execute(sql`
        update scheduled_delivery_items set delivery_id = ${targetId}::uuid, position = ${Number(pos ?? 0)}, version = version + 1, updated_at = now()
        where id = ${itemId}::uuid
      `);
      await tx.execute(sql`update scheduled_deliveries set version = version + 1, updated_at = now() where id = ${deliveryId}::uuid`);
      const payload = { itemId, product: String(item.product), from: cur.delivery_date, to: date, reason: r.value };
      await audit(tx, actor, { action: "move_item_out", deliveryId, payload: { ...payload, targetDeliveryId: targetId } });
      await audit(tx, actor, { action: "move_item_in", deliveryId: targetId, payload: { ...payload, sourceDeliveryId: deliveryId } });
    });
    return { source: await this.get(actor, deliveryId), target: await this.get(actor, targetId) };
  },

  /**
   * Quita (baja LÓGICA, con motivo) un producto de una entrega programada. No se puede con trabajos vinculados (las
   * entregas físicas y sus trabajos nunca se borran desde acá) ni si es el único producto (para eso: cancelar la entrega).
   */
  async deleteItem(actor: EntregasActor, deliveryId: string, itemId: string, reason: unknown, expectedVersion: number): Promise<ScheduledDelivery> {
    assertManage(actor);
    const r = validateReason(reason);
    if (!r.ok) throw new OrdersValidationError(r.message);
    const db = requireDb();
    await db.transaction(async (tx) => {
      const cur = await lockDelivery(tx, deliveryId);
      if (cur.status === "cancelada") throw new EntregasConflictError("La entrega está cancelada: no se puede modificar.");
      if (Number(cur.version) !== expectedVersion) throw new EntregasConflictError("Otra persona modificó esta entrega. Recargá y volvé a aplicar tu cambio.");
      const items = (await tx.execute(sql`
        select id, product from scheduled_delivery_items where delivery_id = ${deliveryId}::uuid and deleted_at is null
      `)).rows as Row[];
      const item = items.find((i) => String(i.id) === itemId);
      if (!item) throw new OrdersNotFoundError("El producto ya no está en esta entrega. Recargá.");
      const links = (await tx.execute(sql`select 1 from scheduled_delivery_links where item_id = ${itemId}::uuid and unlinked_at is null limit 1`)).rows;
      if (links.length) throw new EntregasConflictError(`«${String(item.product)}» tiene trabajos vinculados: desvinculalos antes de quitarlo.`);
      if (items.length === 1) throw new EntregasConflictError("Es el único producto de la entrega: para quitarla usá «Cancelar entrega».");
      await tx.execute(sql`
        update scheduled_delivery_items set deleted_at = now(), deleted_by = ${actor.email}, deleted_reason = ${r.value}, updated_at = now()
        where id = ${itemId}::uuid
      `);
      await tx.execute(sql`update scheduled_deliveries set version = version + 1, updated_at = now() where id = ${deliveryId}::uuid`);
      await audit(tx, actor, { action: "delete_item", deliveryId, payload: { itemId, product: String(item.product), reason: r.value } });
    });
    return this.get(actor, deliveryId);
  },

  /** Restaura un producto quitado (motivo obligatorio). La entrega tiene que estar vigente. */
  async restoreItem(actor: EntregasActor, deliveryId: string, itemId: string, reason: unknown): Promise<ScheduledDelivery> {
    assertManage(actor);
    const r = validateReason(reason);
    if (!r.ok) throw new OrdersValidationError(r.message);
    const db = requireDb();
    await db.transaction(async (tx) => {
      const cur = await lockDelivery(tx, deliveryId);
      if (cur.status === "cancelada") throw new EntregasConflictError("La entrega está cancelada: restaurala primero.");
      const row = ((await tx.execute(sql`
        select id, product, deleted_at, deleted_reason from scheduled_delivery_items where id = ${itemId}::uuid and delivery_id = ${deliveryId}::uuid
      `)).rows as Row[])[0];
      if (!row) throw new OrdersNotFoundError("Producto no encontrado.");
      if (!row.deleted_at) return; // idempotente
      const pos = ((await tx.execute(sql`
        select coalesce(max(position) + 1, 0) as p from scheduled_delivery_items where delivery_id = ${deliveryId}::uuid and deleted_at is null
      `)).rows as Row[])[0]?.p;
      await tx.execute(sql`
        update scheduled_delivery_items set deleted_at = null, deleted_by = null, deleted_reason = null, position = ${Number(pos ?? 0)},
          version = version + 1, updated_at = now() where id = ${itemId}::uuid
      `);
      await tx.execute(sql`update scheduled_deliveries set version = version + 1, updated_at = now() where id = ${deliveryId}::uuid`);
      await audit(tx, actor, { action: "restore_item", deliveryId, payload: { itemId, product: String(row.product), reason: r.value, deletedReason: str(row.deleted_reason) } });
    });
    return this.get(actor, deliveryId);
  },

  /** Productos quitados de una entrega (solo Producción, para restaurarlos). */
  async deletedItems(actor: EntregasActor, deliveryId: string): Promise<ScheduledDeliveryItem[]> {
    assertView(actor);
    if (!canManageEntregas(actor.sector)) return [];
    const db = requireDb();
    const rows = (await db.execute(sql`
      select i.id, i.delivery_id, i.product, i.quantity, i.unit, i.sector, to_char(i.planned_production_date, 'YYYY-MM-DD') as planned_production_date,
             i.lot, i.vto, i.notes, i.position, i.version, i.created_at, i.updated_at, i.deleted_at, i.deleted_by, i.deleted_reason
      from scheduled_delivery_items i where i.delivery_id = ${deliveryId}::uuid and i.deleted_at is not null order by i.deleted_at desc
    `)).rows as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      deliveryId: String(r.delivery_id),
      product: String(r.product),
      quantity: str(r.quantity),
      unit: str(r.unit),
      sector: (str(r.sector) as ItemSector | null) ?? null,
      plannedProductionDate: str(r.planned_production_date),
      lot: str(r.lot),
      vto: str(r.vto),
      notes: str(r.notes),
      position: Number(r.position ?? 0),
      version: Number(r.version ?? 1),
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
      works: [],
      status: "programada",
      deletedAt: iso(r.deleted_at),
      deletedBy: str(r.deleted_by),
      deletedReason: str(r.deleted_reason),
    }));
  },

  /**
   * Edita, desde el calendario, una entrega «Desde trabajo» (un trabajo sin entrega programada): fecha de entrega, cantidad
   * programada y observaciones. Se hace con la edición canónica del trabajo (validación, versión, protecciones, motivo e
   * historial del trabajo), así que el cambio queda en el propio trabajo: persiste y nada lo vuelve a pisar.
   */
  async editWork(
    actor: EntregasActor,
    workItemId: string,
    changes: { deliveryDate?: string | null; plannedQuantity?: string | null; notes?: string | null },
    reason: unknown
  ): Promise<{ workItemId: string; applied: string[] }> {
    assertManage(actor);
    const r = optionalReason(reason);
    const db = requireDb();
    const row = ((await db.execute(sql`
      select w.version, to_char(w.delivery_date, 'YYYY-MM-DD') as delivery_date, w.planned_quantity, w.notes,
             (${NOT_CANCELLED_WORK}) as vigente,
             exists (select 1 from scheduled_delivery_links l where l.work_item_id = w.id and l.unlinked_at is null) as linked
      from work_items w where w.id = ${workItemId}::uuid
    `)).rows as Row[])[0];
    if (!row) throw new OrdersNotFoundError("Trabajo no encontrado.");
    if (!row.vigente) throw new EntregasConflictError("El trabajo está cancelado o eliminado: no se edita desde el calendario.");
    const fields: Array<{ field: "deliveryDate" | "plannedQuantity" | "notes"; value: string | null; from: string | null }> = [];
    if (changes.deliveryDate !== undefined) {
      const v = changes.deliveryDate?.trim() || null;
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new OrdersValidationError("La fecha de entrega no es válida.");
      if (row.linked && v !== str(row.delivery_date)) {
        throw new EntregasConflictError("El trabajo está dentro de una entrega programada: cambiá la fecha de esa entrega (o del producto).");
      }
      if (v !== str(row.delivery_date)) fields.push({ field: "deliveryDate", value: v, from: str(row.delivery_date) });
    }
    if (changes.plannedQuantity !== undefined) {
      const v = changes.plannedQuantity?.trim() || null;
      if (v !== str(row.planned_quantity)) fields.push({ field: "plannedQuantity", value: v, from: str(row.planned_quantity) });
    }
    if (changes.notes !== undefined) {
      const v = changes.notes?.trim() || null;
      if (v !== str(row.notes)) fields.push({ field: "notes", value: v, from: str(row.notes) });
    }
    if (fields.length === 0) throw new OrdersValidationError("No hay cambios para guardar.");
    const cellChanges: WorkItemCellChange[] = fields.map((f) => ({
      id: `native:${workItemId}`,
      field: f.field,
      value: f.value ?? "",
      expectedVersion: Number(row.version),
      reason: r.value ? `Calendario de Entregas: ${r.value}` : undefined,
    }));
    const { results, ok } = await applyWorkItemCellChanges(
      { email: actor.email, sector: actor.sector, displayName: actor.displayName ?? actor.email },
      cellChanges
    );
    if (!ok) {
      const first = results.find((x) => !x.ok) as { message?: string } | undefined;
      throw new EntregasConflictError(first?.message ?? "No se pudo guardar el cambio en el trabajo.");
    }
    await db.transaction(async (tx) => {
      await audit(tx, actor, {
        action: "work_edit",
        deliveryId: `work:${workItemId}`,
        payload: { workItemId, fields: fields.map((f) => ({ field: f.field, from: f.from, to: f.value })), reason: r.value },
      });
    });
    return { workItemId, applied: fields.map((f) => f.field) };
  },

  /**
   * Quita del calendario la aparición «Desde trabajo» de un trabajo (baja LÓGICA con motivo; no reaparece aunque el trabajo
   * conserve su fecha). El trabajo NO se toca y sus entregas REALES siguen apareciendo (no se borran entregas físicas).
   */
  async hideWork(actor: EntregasActor, workItemId: string, reason: unknown): Promise<void> {
    assertManage(actor);
    const r = validateReason(reason);
    if (!r.ok) throw new OrdersValidationError(r.message);
    const db = requireDb();
    await db.transaction(async (tx) => {
      const exists = ((await tx.execute(sql`select 1 from work_items where id = ${workItemId}::uuid`)).rows as Row[]).length;
      if (!exists) throw new OrdersNotFoundError("Trabajo no encontrado.");
      const res = (await tx.execute(sql`
        insert into delivery_calendar_hidden (id, work_item_id, reason, hidden_by, hidden_by_sector)
        values (${randomUUID()}::uuid, ${workItemId}::uuid, ${r.value}, ${actor.email}, ${actor.sector})
        on conflict do nothing returning id
      `)).rows as Row[];
      if (res.length === 0) return; // ya estaba quitada: idempotente
      await audit(tx, actor, { action: "hide_work", deliveryId: `work:${workItemId}`, payload: { workItemId, reason: r.value } });
    });
  },

  /** Vuelve a mostrar en el calendario un trabajo quitado (motivo obligatorio). */
  async restoreWork(actor: EntregasActor, workItemId: string, reason: unknown): Promise<void> {
    assertManage(actor);
    const r = validateReason(reason);
    if (!r.ok) throw new OrdersValidationError(r.message);
    const db = requireDb();
    await db.transaction(async (tx) => {
      const res = (await tx.execute(sql`
        update delivery_calendar_hidden set restored_at = now(), restored_by = ${actor.email}, restore_reason = ${r.value}
        where work_item_id = ${workItemId}::uuid and restored_at is null returning reason
      `)).rows as Row[];
      if (res.length === 0) return; // no estaba quitada: idempotente
      await audit(tx, actor, { action: "restore_work", deliveryId: `work:${workItemId}`, payload: { workItemId, reason: r.value, hiddenReason: str(res[0]!.reason) } });
    });
  },

  /** Historial de las correcciones hechas desde el calendario sobre un trabajo (solo Producción). */
  async workHistory(actor: EntregasActor, workItemId: string): Promise<DeliveryHistoryEntry[]> {
    assertView(actor);
    if (!canManageEntregas(actor.sector)) return [];
    const db = requireDb();
    const rows = (await db.execute(sql`
      select id, action, actor_email, actor_sector, entity_id, payload, created_at
      from feature_audit_events where domain = 'entregas' and entity_id = ${`work:${workItemId}`}
      order by created_at desc, id desc limit 200
    `)).rows as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      action: String(r.action),
      actorEmail: String(r.actor_email),
      actorSector: String(r.actor_sector),
      entityId: str(r.entity_id),
      payload: (r.payload ?? {}) as Record<string, unknown>,
      createdAt: iso(r.created_at),
    }));
  },

  /** Auditoría de fechas del calendario (SOLO LECTURA, no escribe nada). Ver `entregasDateAudit`. */
  async dateAudit(actor: EntregasActor): Promise<EntregasDateAudit> {
    assertView(actor);
    if (!canManageEntregas(actor.sector)) throw new OrdersForbiddenError("Solo Producción ve la auditoría de fechas.");
    return entregasDateAudit();
  },

  async history(actor: EntregasActor, deliveryId: string): Promise<DeliveryHistoryEntry[]> {
    assertView(actor);
    const db = requireDb();
    await this.get(actor, deliveryId); // valida visibilidad
    // El historial guarda la entrega COMPLETA (todos los productos y sectores): solo lo ve quien administra Entregas.
    // Envasado/Depósito consultan la entrega recortada, nunca el historial (evita filtrar productos de otro sector).
    if (!canManageEntregas(actor.sector)) return [];
    const rows = (await db.execute(sql`
      select id, action, actor_email, actor_sector, entity_id, payload, created_at
      from feature_audit_events where domain = 'entregas' and entity_id = ${deliveryId}
      order by created_at desc, id desc limit 200
    `)).rows as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      action: String(r.action),
      actorEmail: String(r.actor_email),
      actorSector: String(r.actor_sector),
      entityId: str(r.entity_id),
      payload: (r.payload ?? {}) as Record<string, unknown>,
      createdAt: iso(r.created_at),
    }));
  },
};

// ───────────────────────── helpers de escritura ─────────────────────────

/** Actualiza la «foto» del vínculo SOLO para los campos indicados (los demás siguen avisando). */
async function refreshSnapshot(tx: SqlTx, linkId: string, delivery: ScheduledDelivery, item: ScheduledDeliveryItem, fields: string[]) {
  const snap = snapshotOf(delivery, item) as Record<string, string | null>;
  const patch = Object.fromEntries(fields.filter((f) => f in snap).map((f) => [f, snap[f]]));
  await tx.execute(sql`update scheduled_delivery_links set item_snapshot = item_snapshot || ${JSON.stringify(patch)}::jsonb where id = ${linkId}::uuid`);
}

async function lockDelivery(tx: SqlTx, id: string): Promise<Row & { delivery_date: string }> {
  const res = (await tx.execute(sql`
    select id, status, version, to_char(delivery_date, 'YYYY-MM-DD') as delivery_date from scheduled_deliveries where id = ${id}::uuid for update
  `)).rows as Row[];
  const row = res[0];
  if (!row) throw new OrdersNotFoundError("Entrega no encontrada.");
  return row as Row & { delivery_date: string };
}

async function insertItems(tx: SqlTx, deliveryId: string, items: CleanDelivery["items"], startPosition: number) {
  let position = startPosition;
  for (const i of items) {
    await tx.execute(sql`
      insert into scheduled_delivery_items (id, delivery_id, product, quantity, unit, sector, planned_production_date, lot, vto, notes, position)
      values (${randomUUID()}::uuid, ${deliveryId}::uuid, ${i.product}, ${i.quantity}, ${i.unit}, ${i.sector}, ${i.plannedProductionDate}::date, ${i.lot}, ${i.vto}, ${i.notes}, ${position})
    `);
    position += 1;
  }
}

const snapshot = (c: CleanDelivery) => ({
  client: c.client,
  deliveryDate: c.deliveryDate,
  responsible: c.responsible,
  notes: c.notes,
  items: c.items.map((i) => ({ product: i.product, quantity: i.quantity, unit: i.unit, sector: i.sector, plannedProductionDate: i.plannedProductionDate, lot: i.lot, vto: i.vto, notes: i.notes })),
});
const snapshotFromDelivery = (d: ScheduledDelivery) => ({
  client: d.client,
  deliveryDate: d.deliveryDate,
  responsible: d.responsible,
  notes: d.notes,
  items: d.items.map((i) => ({ product: i.product, quantity: i.quantity, unit: i.unit, sector: i.sector, plannedProductionDate: i.plannedProductionDate, lot: i.lot, vto: i.vto, notes: i.notes })),
});

/**
 * Inserta el vínculo producto ↔ trabajo dentro de una transacción (la usa «Asignar trabajo» y la vinculación manual).
 * Valida: entrega no cancelada, producto vigente, sector compatible, trabajo vigente y no vinculado a otro producto
 * (índice único parcial: no se duplica), y —cuando viene de «Asignar trabajo»— que cliente y producto coincidan con
 * las mismas reglas con las que se sugirió. Idempotente: si ya estaba vinculado a este mismo producto, no hace nada.
 */
export async function linkWorkInTx(
  tx: SqlTx,
  actor: EntregasActor,
  params: { itemId: string; workItemId: string; requireMatch: boolean }
): Promise<string> {
  const itemRows = (await tx.execute(sql`
    select i.id, i.product, i.sector, i.deleted_at, i.quantity, i.unit, i.lot, i.vto, d.id as delivery_id, d.client, d.status,
           to_char(d.delivery_date, 'YYYY-MM-DD') as delivery_date
    from scheduled_delivery_items i join scheduled_deliveries d on d.id = i.delivery_id
    where i.id = ${params.itemId}::uuid for update of d
  `)).rows as Row[];
  const item = itemRows[0];
  if (!item || item.deleted_at) throw new OrdersNotFoundError("El producto de la entrega ya no existe.");
  if (item.status === "cancelada") throw new EntregasConflictError("La entrega está cancelada: no se puede vincular.");
  const workRows = (await tx.execute(sql`
    select id, client, product, sector, deleted_at, operational_cancelled_at from work_items where id = ${params.workItemId}::uuid
  `)).rows as Row[];
  const work = workRows[0];
  if (!work || work.deleted_at || work.operational_cancelled_at) throw new OrdersNotFoundError("El trabajo no existe o fue cancelado/eliminado.");
  const sector = String(work.sector);
  if (sector !== "ENVASADO_MASIVO" && sector !== "ENVASADO_PREMIUM") {
    throw new OrdersValidationError("Solo se vinculan trabajos de Envasado Masivo o Premium.");
  }
  if (item.sector && String(item.sector) !== sector) {
    throw new OrdersValidationError(`Este producto es de ${DELIVERY_SECTOR_LABEL[String(item.sector) as DeliverySector]}: el trabajo es de ${DELIVERY_SECTOR_LABEL[sector as DeliverySector]}.`);
  }
  if (params.requireMatch) {
    const { clienteRelation, productoRelation } = await import("@/lib/asignacion-lotes/resolve-for-work-item");
    if (clienteRelation(String(work.client), String(item.client)) === "NONE" || productoRelation({ producto: String(item.product), codigo: "", marca: String(item.client) }, String(work.product)) === "NONE") {
      throw new OrdersValidationError("El trabajo no coincide con el cliente y producto de la entrega elegida.");
    }
  }
  const existing = (await tx.execute(sql`
    select id, item_id from scheduled_delivery_links where work_item_id = ${params.workItemId}::uuid and unlinked_at is null
  `)).rows as Row[];
  if (existing[0]) {
    if (String(existing[0].item_id) === params.itemId) return String(item.delivery_id); // idempotente
    throw new EntregasConflictError("Este trabajo ya está vinculado a otra entrega. Desvinculalo primero.");
  }
  const snapshot = snapshotOf(
    { deliveryDate: String(item.delivery_date) },
    { quantity: str(item.quantity), unit: str(item.unit), lot: str(item.lot), vto: str(item.vto) }
  );
  await tx.execute(sql`
    insert into scheduled_delivery_links (id, item_id, work_item_id, linked_by, linked_by_sector, item_snapshot)
    values (${randomUUID()}::uuid, ${params.itemId}::uuid, ${params.workItemId}::uuid, ${actor.email}, ${actor.sector}, ${JSON.stringify(snapshot)}::jsonb)
  `);
  await audit(tx, actor, {
    action: "link",
    deliveryId: String(item.delivery_id),
    payload: { itemId: params.itemId, product: String(item.product), workItemId: params.workItemId, workSector: sector },
  });
  return String(item.delivery_id);
}

/** Datos de la entrega que «Asignar trabajo» usa para completar (solo lo vacío) campos del trabajo. */
export async function readDeliveryItemForAssignment(
  tx: SqlTx,
  itemId: string
): Promise<{ itemId: string; deliveryId: string; client: string; product: string; sector: DeliverySector | null; deliveryDate: string; unit: string | null; lot: string | null; vto: string | null; state: string; deleted: boolean } | null> {
  const rows = (await tx.execute(sql`
    select i.id, i.product, i.sector, i.unit, i.lot, i.vto, i.deleted_at, d.id as delivery_id, d.client, d.status,
           to_char(d.delivery_date, 'YYYY-MM-DD') as delivery_date
    from scheduled_delivery_items i join scheduled_deliveries d on d.id = i.delivery_id where i.id = ${itemId}::uuid
  `)).rows as Row[];
  const r = rows[0];
  if (!r) return null;
  return {
    itemId: String(r.id),
    deliveryId: String(r.delivery_id),
    client: String(r.client),
    product: String(r.product),
    sector: (str(r.sector) as DeliverySector | null) ?? null,
    deliveryDate: String(r.delivery_date),
    unit: str(r.unit),
    lot: str(r.lot),
    vto: str(r.vto),
    state: String(r.status),
    deleted: Boolean(r.deleted_at),
  };
}
