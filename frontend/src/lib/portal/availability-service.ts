/**
 * «Listo para entregar» — confirmación explícita de disponibilidad (servidor).
 *
 * Alcance: SOLO escribe en `portal_availability_marks` y `portal_availability_audit` (y avisos del portal al rectificar).
 * NO toca trabajos, entregas físicas, líneas de entrega, stock, movimientos, consumos de MP, lotes ni transferencias.
 * Garantías: permisos por sector validados acá (no solo en la interfaz), transacción con bloqueo de la fila del trabajo
 * (dos confirmaciones simultáneas se serializan), idempotencia por clave (doble clic = una sola marca), cantidades acotadas
 * a lo terminado y no cubierto, y auditoría append-only con valores anteriores y nuevos.
 */
import { emitBillingNotification } from "@/lib/notifications/billing-notifications";
import type { BillingEvent } from "@/lib/notifications/billing-notification-builder";
import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { parseQuantity } from "@/lib/planning/circuit/delivery-math";
import {
  availabilityFigures,
  BLOCK_MESSAGES,
  canActorMark,
  canActorRetract,
  canRetractMark,
  checkRequestedQuantity,
  evaluateAvailability,
  type AvailabilityBlock,
  type AvailabilityEvaluation,
} from "./availability-rules";
import { isoOrNull } from "./store";

type Row = Record<string, unknown>;
type Exec = { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> };

export class AvailabilityError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "AVAILABILITY_ERROR") {
    super(message);
    this.name = "AvailabilityError";
  }
}

export type AvailabilityActor = { email: string; sector: string; displayName?: string | null };

export type AvailabilityMarkView = {
  id: string;
  quantity: number;
  unit: string | null;
  sector: string;
  markedBy: string;
  markedAt: string;
  /** El usuario actual puede rectificarla (permiso) y no hay entregas que dependan de ella. */
  canRetract: boolean;
  retractBlockedReason: string | null;
};

export type AvailabilityState = {
  workItemId: string;
  client: string;
  product: string;
  orderRef: string | null;
  sector: string;
  unit: string | null;
  /** El usuario actual puede marcar este trabajo ahora (sector correcto + cantidad marcable + trabajo vigente). */
  canMark: boolean;
  reason: string | null;
  code: AvailabilityBlock | "FORBIDDEN_SECTOR" | null;
  maxQuantity: number;
  produced: number | null;
  target: number | null;
  marked: number;
  delivered: number;
  available: number;
  marks: AvailabilityMarkView[];
};

function db(): Exec {
  if (!isDatabaseConfigured()) throw new AvailabilityError("La base de datos no está configurada en este entorno.", 503, "NO_DB");
  return getDb() as unknown as Exec;
}

const WORK_COLUMNS = sql`
  w.id::text as id, w.client, w.product, w.sector::text as sector, w.operational_status, w.deleted_at, w.operational_cancelled_at,
  w.unit, w.planned_quantity, w.finished_qty, w.deliverable_units, w.packaging_total_units, p.op as pedido_op`;

async function loadWork(tx: Exec, workItemId: string, lock: boolean): Promise<Row | null> {
  const rows = (await tx.execute(
    lock
      ? sql`select ${WORK_COLUMNS} from work_items w left join production_pedidos p on p.id = w.production_pedido_id and p.deleted_at is null where w.id = ${workItemId}::uuid for update of w`
      : sql`select ${WORK_COLUMNS} from work_items w left join production_pedidos p on p.id = w.production_pedido_id and p.deleted_at is null where w.id = ${workItemId}::uuid`,
  )).rows as Row[];
  return rows[0] ?? null;
}

/** Unidades entregadas físicamente: mismo criterio que el portal (líneas vigentes + registros históricos sin líneas). */
async function deliveredUnits(tx: Exec, workItemId: string, unit: string | null): Promise<number> {
  const lines = (await tx.execute(sql`
    select coalesce(sum(l.quantity), 0)::float8 as q from work_item_delivery_lines l left join work_item_deliveries d on d.id = l.delivery_id
     where l.work_item_id = ${workItemId}::uuid and l.status = 'ACTIVA' and (d.id is null or (d.status::text = 'ENTREGADO' and d.deleted_at is null))`)).rows as Row[];
  const legacy = (await tx.execute(sql`
    select d.quantity from work_item_deliveries d
     where d.work_item_id = ${workItemId}::uuid and d.status::text = 'ENTREGADO' and d.deleted_at is null
       and not exists (select 1 from work_item_delivery_lines l2 where l2.delivery_id = d.id and l2.status = 'ACTIVA')`)).rows as Row[];
  let total = Number(lines[0]?.q ?? 0);
  for (const r of legacy) {
    const q = parseQuantity(r.quantity == null ? null : String(r.quantity), unit);
    if (typeof q === "number") total += q;
  }
  return total;
}

async function activeMarks(tx: Exec, workItemId: string): Promise<Row[]> {
  return (await tx.execute(sql`
    select id::text as id, quantity, unit, sector, marked_by, marked_at from portal_availability_marks
     where work_item_id = ${workItemId}::uuid and retracted_at is null order by marked_at, id`)).rows as Row[];
}

/** Entregado al hacerse la PRIMERA confirmación del trabajo (aunque luego se retirara); null si nunca hubo una. */
async function markBase(tx: Exec, workItemId: string): Promise<number | null> {
  const r = (await tx.execute(sql`select delivered_before from portal_availability_marks where work_item_id = ${workItemId}::uuid order by marked_at, id limit 1`)).rows as Row[];
  return r[0] ? Number(r[0].delivered_before ?? 0) : null;
}

function evaluate(work: Row, delivered: number, marked: number, base: number | null): AvailabilityEvaluation {
  return evaluateAvailability({
    sector: String(work.sector),
    status: String(work.operational_status ?? "pendiente"),
    unit: work.unit == null ? null : String(work.unit),
    plannedQuantity: work.planned_quantity == null ? null : String(work.planned_quantity),
    finishedQty: work.finished_qty == null ? null : String(work.finished_qty),
    deliverableUnits: work.deliverable_units == null ? null : Number(work.deliverable_units),
    packagingTotalUnits: work.packaging_total_units == null ? null : Number(work.packaging_total_units),
    deleted: work.deleted_at != null,
    cancelled: work.operational_cancelled_at != null || String(work.operational_status) === "cancelado",
    delivered,
    marked,
    markBase: base,
  });
}

async function buildState(tx: Exec, work: Row, actor: AvailabilityActor): Promise<AvailabilityState> {
  const unit = work.unit == null ? null : String(work.unit);
  const id = String(work.id);
  const delivered = await deliveredUnits(tx, id, unit);
  const marks = await activeMarks(tx, id);
  const marked = marks.reduce((s, m) => s + Number(m.quantity), 0);
  const base = await markBase(tx, id);
  const ev = evaluate(work, delivered, marked, base);
  const sectorOk = canActorMark(actor.sector, String(work.sector));
  const block = ev.block;
  const canMark = sectorOk && block == null;
  return {
    workItemId: id,
    client: String(work.client ?? ""),
    product: String(work.product ?? ""),
    orderRef: work.pedido_op ? String(work.pedido_op).trim() || null : null,
    sector: String(work.sector),
    unit,
    canMark,
    reason: !sectorOk ? BLOCK_MESSAGES.SECTOR_NO_APLICA : block ? BLOCK_MESSAGES[block] : null,
    code: !sectorOk ? "FORBIDDEN_SECTOR" : block,
    maxQuantity: sectorOk && block == null ? ev.maxQuantity : 0,
    produced: ev.produced,
    target: ev.target,
    marked,
    delivered,
    available: ev.available,
    marks: marks.map((m) => {
      const permitted = canActorRetract(actor.sector, String(m.sector));
      const safe = canRetractMark(marks.map((x) => ({ id: String(x.id), quantity: Number(x.quantity) })), String(m.id), availabilityFigures({ marked, delivered, markBase: base }).deliveredSince);
      return {
        id: String(m.id),
        quantity: Number(m.quantity),
        unit: m.unit == null ? null : String(m.unit),
        sector: String(m.sector),
        markedBy: String(m.marked_by),
        markedAt: isoOrNull(m.marked_at)!,
        canRetract: permitted && safe,
        retractBlockedReason: !permitted ? "Tu sector no puede rectificar esta disponibilidad." : !safe ? "Ya hay entregas registradas sobre estas unidades: no se puede retirar la disponibilidad." : null,
      };
    }),
  };
}

/** Estado de disponibilidad de un trabajo para el usuario actual (lectura, sin bloquear). */
export async function getAvailabilityState(actor: AvailabilityActor, workItemId: string): Promise<AvailabilityState> {
  const d = db();
  const work = await loadWork(d, workItemId, false);
  if (!work) throw new AvailabilityError("Trabajo no encontrado.", 404, "NOT_FOUND");
  return buildState(d, work, actor);
}

export type MarkResult = { replayed: boolean; markId: string; quantity: number; state: AvailabilityState };

/** Confirma que una cantidad está terminada y disponible para entregar. Idempotente por clave. */
export async function markReadyForDelivery(
  actor: AvailabilityActor,
  input: { workItemId: string; quantity?: unknown; idempotencyKey?: unknown },
): Promise<MarkResult> {
  const key = typeof input.idempotencyKey === "string" && /^[A-Za-z0-9_.:-]{8,120}$/.test(input.idempotencyKey) ? input.idempotencyKey : null;
  if (!key) throw new AvailabilityError("Falta la clave de la operación (protección contra doble clic).", 400, "NO_KEY");
  if (!/^[0-9a-f-]{36}$/i.test(input.workItemId)) throw new AvailabilityError("Trabajo inválido.", 400, "BAD_WORK");

  let notice: BillingEvent | null = null;
  const marked = await (getDb() as unknown as { transaction: <T>(fn: (tx: Exec) => Promise<T>) => Promise<T> }).transaction(async (tx) => {
    // Bloquea la fila del trabajo: dos confirmaciones simultáneas del mismo trabajo se serializan.
    const work = await loadWork(tx, input.workItemId, true);
    if (!work) throw new AvailabilityError("Trabajo no encontrado.", 404, "NOT_FOUND");
    // Permiso de sector: SIEMPRE en el servidor, sobre el sector que tiene el trabajo HOY.
    if (!canActorMark(actor.sector, String(work.sector))) {
      throw new AvailabilityError(BLOCK_MESSAGES.SECTOR_NO_APLICA, 403, "FORBIDDEN_SECTOR");
    }

    // Replay: misma clave = misma operación (no suma unidades dos veces).
    const prior = (await tx.execute(sql`select id::text as id, work_item_id::text as work_item_id, quantity, retracted_at from portal_availability_marks where idempotency_key = ${key}`)).rows as Row[];
    if (prior[0]) {
      if (String(prior[0].work_item_id) !== String(work.id)) throw new AvailabilityError("La clave ya se usó en otra operación.", 409, "KEY_REUSED");
      return { replayed: true, markId: String(prior[0].id), quantity: Number(prior[0].quantity), state: await buildState(tx, work, actor) };
    }

    const unit = work.unit == null ? null : String(work.unit);
    const delivered = await deliveredUnits(tx, String(work.id), unit);
    const marks = await activeMarks(tx, String(work.id));
    const marked = marks.reduce((s, m) => s + Number(m.quantity), 0);
    const base = await markBase(tx, String(work.id));
    const ev = evaluate(work, delivered, marked, base);
    if (ev.block) throw new AvailabilityError(BLOCK_MESSAGES[ev.block], 409, ev.block);
    const q = checkRequestedQuantity(input.quantity, ev, unit);
    if (!q.ok) throw new AvailabilityError(q.message, q.code === "EXCEEDS" ? 409 : 400, q.code);

    const markId = randomUUID();
    const orderRef = work.pedido_op ? String(work.pedido_op).trim() || null : null;
    await tx.execute(sql`
      insert into portal_availability_marks (id, work_item_id, quantity, unit, delivered_before, client_name, product, order_ref, sector, marked_by, marked_by_name, idempotency_key)
      values (${markId}::uuid, ${String(work.id)}::uuid, ${q.quantity}, ${unit}, ${delivered}, ${String(work.client ?? "")}, ${String(work.product ?? "")}, ${orderRef},
              ${String(work.sector)}, ${actor.email}, ${actor.displayName ?? null}, ${key})`);
    await tx.execute(sql`
      insert into portal_availability_audit (mark_id, work_item_id, action, actor, actor_name, actor_sector, client_name, product, order_ref, quantity, unit, before_state, after_state)
      values (${markId}::uuid, ${String(work.id)}::uuid, 'MARCAR', ${actor.email}, ${actor.displayName ?? null}, ${actor.sector}, ${String(work.client ?? "")}, ${String(work.product ?? "")}, ${orderRef},
              ${q.quantity}, ${unit},
              ${JSON.stringify({ marked, delivered, available: ev.available })}::jsonb,
              ${JSON.stringify({ marked: marked + q.quantity, delivered, available: ev.available + q.quantity })}::jsonb)`);
    notice = {
      type: "LISTO_PARA_ENTREGAR",
      eventKey: markId,
      workItemId: String(work.id),
      client: work.client == null ? null : String(work.client),
      product: work.product == null ? null : String(work.product),
      pedido: orderRef,
      orderRef: work.order_number == null ? null : String(work.order_number),
      quantity: q.quantity,
      unit,
      at: new Date(),
      actorName: actor.displayName || actor.email,
    };
    return { replayed: false, markId, quantity: q.quantity, state: await buildState(tx, work, actor) };
  });
  // Aviso a Administración FUERA de la transacción (best-effort, idempotente por marca): «listo» NO es «entregado».
  if (notice) await emitBillingNotification(notice);
  return marked;
}

export type RetractResult = { markId: string; clientNotified: boolean; state: AvailabilityState };

/**
 * Rectifica (retira) una disponibilidad marcada por error. Nunca borra la marca ni toca entregas: solo la deja retirada con
 * usuario, sector, fecha y motivo. Si ya hay entregas que dependen de esas unidades, no se permite. Si el cliente ya había
 * sido avisado, se le muestra el estado corregido en su portal y se registra la incidencia (nada silencioso).
 */
export async function retractAvailability(actor: AvailabilityActor, input: { markId: string; reason?: unknown }): Promise<RetractResult> {
  if (!/^[0-9a-f-]{36}$/i.test(input.markId)) throw new AvailabilityError("Marca inválida.", 400, "BAD_MARK");
  const reason = typeof input.reason === "string" ? input.reason.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  if (reason.length < 3) throw new AvailabilityError("Indicá el motivo de la rectificación.", 400, "NO_REASON");

  return (getDb() as unknown as { transaction: <T>(fn: (tx: Exec) => Promise<T>) => Promise<T> }).transaction(async (tx) => {
    const found = (await tx.execute(sql`select id::text as id, work_item_id::text as work_item_id from portal_availability_marks where id = ${input.markId}::uuid`)).rows as Row[];
    if (!found[0]) throw new AvailabilityError("Marca no encontrada.", 404, "NOT_FOUND");
    const work = await loadWork(tx, String(found[0].work_item_id), true);
    if (!work) throw new AvailabilityError("Trabajo no encontrado.", 404, "NOT_FOUND");
    const mark = ((await tx.execute(sql`
      select id::text as id, quantity, unit, sector, client_name, product, order_ref, retracted_at from portal_availability_marks where id = ${input.markId}::uuid for update`)).rows as Row[])[0];
    if (!mark) throw new AvailabilityError("Marca no encontrada.", 404, "NOT_FOUND");
    if (!canActorRetract(actor.sector, String(mark.sector))) throw new AvailabilityError("Tu sector no puede rectificar esta disponibilidad.", 403, "FORBIDDEN");
    if (mark.retracted_at != null) throw new AvailabilityError("Esta disponibilidad ya fue retirada.", 409, "ALREADY_RETRACTED");

    const unit = work.unit == null ? null : String(work.unit);
    const delivered = await deliveredUnits(tx, String(work.id), unit);
    const marks = await activeMarks(tx, String(work.id));
    const marked = marks.reduce((s, m) => s + Number(m.quantity), 0);
    const base = await markBase(tx, String(work.id));
    const q = Number(mark.quantity);
    if (!canRetractMark(marks.map((x) => ({ id: String(x.id), quantity: Number(x.quantity) })), input.markId, availabilityFigures({ marked, delivered, markBase: base }).deliveredSince)) {
      throw new AvailabilityError("Ya hay entregas registradas sobre estas unidades: no se puede retirar la disponibilidad ni alterar esas entregas.", 409, "DELIVERED");
    }

    await tx.execute(sql`
      update portal_availability_marks set retracted_at = now(), retracted_by = ${actor.email}, retracted_by_sector = ${actor.sector}, retract_reason = ${reason}
       where id = ${input.markId}::uuid and retracted_at is null`);
    await tx.execute(sql`
      insert into portal_availability_audit (mark_id, work_item_id, action, actor, actor_name, actor_sector, client_name, product, order_ref, quantity, unit, before_state, after_state, note)
      values (${input.markId}::uuid, ${String(work.id)}::uuid, 'RETIRAR', ${actor.email}, ${actor.displayName ?? null}, ${actor.sector}, ${mark.client_name == null ? null : String(mark.client_name)},
              ${mark.product == null ? null : String(mark.product)}, ${mark.order_ref == null ? null : String(mark.order_ref)}, ${q}, ${unit},
              ${JSON.stringify({ marked, delivered, available: availabilityFigures({ marked, delivered, markBase: base }).available })}::jsonb,
              ${JSON.stringify({ marked: marked - q, delivered, available: availabilityFigures({ marked: marked - q, delivered, markBase: base }).available })}::jsonb, ${reason})`);

    // Si el cliente ya fue avisado de ESTA disponibilidad: estado corregido visible en su portal + incidencia registrada.
    const notified = (await tx.execute(sql`select client_id::text as client_id from portal_notifications where dedupe_key = ${`ready:${input.markId}`}`)).rows as Row[];
    for (const n of notified) {
      const stillAvailable = availabilityFigures({ marked: marked - q, delivered, markBase: base }).available;
      await tx.execute(sql`
        insert into portal_notifications (client_id, kind, dedupe_key, title, body, payload)
        values (${String(n.client_id)}::uuid, 'DISPONIBILIDAD_CORREGIDA', ${`retract:${input.markId}`}, ${"Actualizamos la disponibilidad de tu pedido"},
                ${`${String(mark.product ?? "Tu producto")}: corregimos un aviso anterior. Cantidad disponible ahora: ${stillAvailable}${unit ? ` ${unit}` : ""}. Si tenés dudas, escribinos.`}, '{}'::jsonb)
        on conflict (client_id, dedupe_key) do nothing`);
      await tx.execute(sql`
        insert into portal_audit_events (client_id, event_type, actor_kind, actor, detail)
        values (${String(n.client_id)}::uuid, 'DISPONIBILIDAD_RETIRADA_CLIENTE_AVISADO', 'STAFF', ${actor.email},
                ${JSON.stringify({ markId: input.markId, workItemId: String(work.id), quantity: q, reason })}::jsonb)`);
    }
    return { markId: input.markId, clientNotified: notified.length > 0, state: await buildState(tx, work, actor) };
  });
}
