import "server-only";

import { and, eq, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { operationalEvents, planningWeeks, workItemDeliveryLines, workItems } from "@/lib/db/schema";
import { weekStartMonday } from "@/lib/operational/operational-calendar";
import { PlanningForbiddenError, PlanningNotFoundError, PlanningValidationError, type PlanningActor } from "@/lib/planning/types";
import { assertIsoDate } from "@/lib/planning/validators";
import { formatQty, parseQty, planSchedules, type NewSchedule } from "./work-schedules";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

export type AddSchedulesInput = {
  /** Programación desde la que se copia (id nativo, sin prefijo). */
  sourceId: string;
  items: Array<{ plannedDate: string; plannedDateTo?: string | null; quantity?: string | number | null }>;
  /** true = la programación origen se queda con la cantidad que falte (reparto 2.000 / 1.500 / 1.500). */
  rebalanceSource?: boolean;
  /** Confirmación explícita para superar la cantidad total de la orden. */
  allowExceed?: boolean;
  idempotencyKey: string;
};

export type ScheduleSummary = { id: string; plannedDate: string; plannedDateTo: string | null; quantity: string; isOriginal: boolean; status: string; deliveredUnits: number };
export type AddSchedulesResult = { created: ScheduleSummary[]; replayed: boolean; schedules: ScheduleSummary[]; total: number; programmed: number; exceeds: boolean };

function assertCanSchedule(actor: PlanningActor) {
  if (actor.sector !== "PRODUCCION" && actor.sector !== "DIRECCION") throw new PlanningForbiddenError("Solo Producción puede programar trabajos en más días.");
}

/** Semana de planificación de una fecha (la crea publicada si no existe, como la asignación normal). */
async function weekFor(tx: Tx, date: string, actorEmail: string) {
  const weekStart = weekStartMonday(date);
  let [week] = await tx.select().from(planningWeeks).where(eq(planningWeeks.weekStart, weekStart)).limit(1);
  if (!week) {
    const now = new Date();
    [week] = await tx.insert(planningWeeks).values({ weekStart, label: `Semana ${weekStart}`, status: "PUBLISHED", publishedAt: now, createdBy: actorEmail }).returning();
  }
  return week as { id: string };
}

async function liveGroup(tx: Tx, rootId: string) {
  return (await tx
    .select()
    .from(workItems)
    .where(and(isNull(workItems.deletedAt), or(eq(workItems.id, rootId), eq(workItems.scheduleRootId, rootId))))) as Array<typeof workItems.$inferSelect>;
}

async function summarize(tx: Tx, rootId: string): Promise<ScheduleSummary[]> {
  const rows = await liveGroup(tx, rootId);
  const out: ScheduleSummary[] = [];
  for (const r of rows.sort((a, b) => String(a.plannedDate).localeCompare(String(b.plannedDate)) || a.createdAt.getTime() - b.createdAt.getTime())) {
    const [d] = await tx.select({ n: sql<number>`coalesce(sum(${workItemDeliveryLines.quantity}),0)::float8` }).from(workItemDeliveryLines).where(and(eq(workItemDeliveryLines.workItemId, r.id), eq(workItemDeliveryLines.status, "ACTIVA")));
    out.push({ id: r.id, plannedDate: String(r.plannedDate), plannedDateTo: r.plannedDateTo ? String(r.plannedDateTo) : null, quantity: r.plannedQuantity, isOriginal: r.id === rootId, status: r.operationalStatus, deliveredUnits: Number(d?.n ?? 0) });
  }
  return out;
}

/**
 * Programa la MISMA OE/OA en otros días. Crea trabajos hijos (fecha y cantidad propias) vinculados a la programación
 * original; NO crea órdenes, NO toca pedidos, consumos de MP, movimientos de stock ni entregas. Sin motivo obligatorio;
 * queda auditado. Idempotente por clave (un doble clic no duplica).
 */
export async function addSchedulesDurable(input: AddSchedulesInput, actor: PlanningActor): Promise<AddSchedulesResult> {
  assertCanSchedule(actor);
  const key = input.idempotencyKey?.trim();
  if (!key || key.length < 8 || key.length > 100) throw new PlanningValidationError("idempotencyKey inválida (8–100 caracteres).");
  if (!Array.isArray(input.items) || input.items.length === 0) throw new PlanningValidationError("Elegí al menos un día.");
  if (input.items.length > 31) throw new PlanningValidationError("Se pueden agregar hasta 31 programaciones por vez.");

  return getDb().transaction(async (tx: Tx) => {
    const [source] = await tx.select().from(workItems).where(eq(workItems.id, input.sourceId)).for("update").limit(1);
    if (!source || source.deletedAt) throw new PlanningNotFoundError("Trabajo no encontrado.");
    if (!source.orderId) throw new PlanningValidationError("Este trabajo no tiene una OE/OA vinculada: no se puede repetir sin crear otra orden.");
    if (source.operationalStatus === "cancelado" || source.status === "CANCELADO") throw new PlanningValidationError("El trabajo está cancelado.");
    if (source.sector === "CODIFICADO") throw new PlanningValidationError("Codificado no se programa por días.");
    const rootId: string = source.scheduleRootId ?? source.id;

    // Replay: la misma clave devuelve lo ya creado.
    const prior = await tx.select().from(workItems).where(sql`${workItems.originRef} like ${`sched:${key}:%`}`);
    if (prior.length > 0) {
      const schedules = await summarize(tx, rootId);
      const total = parseQty((await liveGroup(tx, rootId)).find((r) => r.id === rootId)?.scheduleTotal) ?? 0;
      return { created: schedules.filter((s) => prior.some((p: { id: string }) => p.id === s.id)), replayed: true, schedules, total, programmed: schedules.reduce((s, x) => s + (parseQty(x.quantity) ?? 0), 0), exceeds: false };
    }

    const [root] = rootId === source.id ? [source] : await tx.select().from(workItems).where(eq(workItems.id, rootId)).for("update").limit(1);
    if (!root || root.deletedAt) throw new PlanningValidationError("La programación original ya no existe.");
    const members = await liveGroup(tx, rootId);
    const memberQty = members.map((m) => ({ id: m.id, date: String(m.plannedDate), qty: parseQty(m.plannedQuantity) }));
    if (memberQty.some((m) => m.qty == null)) throw new PlanningValidationError("Alguna programación tiene una cantidad no numérica: corregila antes de repartir.");
    const total = parseQty(root.scheduleTotal) ?? memberQty.reduce((s, m) => s + (m.qty ?? 0), 0);

    const sourceQty = parseQty(source.plannedQuantity);
    const items: NewSchedule[] = input.items.map((it) => ({ date: assertIsoDate(it.plannedDate, "Fecha"), qty: parseQty(it.quantity ?? source.plannedQuantity) ?? Number.NaN }));
    const plan = planSchedules({ members: memberQty.map((m) => ({ id: m.id, date: m.date, qty: m.qty! })), sourceId: source.id, total, items, rebalance: Boolean(input.rebalanceSource), allowExceed: Boolean(input.allowExceed) });
    if (!plan.ok) throw new PlanningValidationError(plan.message);

    const now = new Date();
    const actorName = actor.displayName || actor.email;
    if (input.rebalanceSource && plan.newSourceQty != null) {
      await tx.update(workItems).set({ plannedQuantity: formatQty(plan.newSourceQty), version: sql`${workItems.version} + 1`, updatedAt: now }).where(eq(workItems.id, source.id));
      await tx.insert(operationalEvents).values({ workItemId: source.id, planningWeekId: source.planningWeekId, type: "SCHEDULE_REBALANCED", fromStatus: source.plannedQuantity, toStatus: formatQty(plan.newSourceQty), actorEmail: actor.email, actorSector: actor.sector, note: `Reparto en ${items.length + 1} programaciones de la misma orden (total ${formatQty(total)})` });
    }
    if (!root.scheduleTotal) await tx.update(workItems).set({ scheduleTotal: formatQty(total), updatedAt: now }).where(eq(workItems.id, rootId));

    const createdIds: string[] = [];
    let i = 0;
    for (const it of input.items) {
      const date = assertIsoDate(it.plannedDate, "Fecha");
      const dateTo = it.plannedDateTo?.trim() ? assertIsoDate(it.plannedDateTo, "Hasta") : null;
      if (dateTo && dateTo < date) throw new PlanningValidationError("Hasta no puede ser anterior a Desde.");
      const week = await weekFor(tx, date, actor.email);
      const [row] = await tx
        .insert(workItems)
        .values({
          planningWeekId: week.id,
          plannedDate: date,
          plannedDateTo: dateTo,
          client: source.client,
          product: source.product,
          plannedQuantity: formatQty(items[i]!.qty),
          unit: source.unit,
          sector: source.sector,
          line: source.line,
          branchOwner: source.branchOwner,
          priority: source.priority,
          notes: source.notes,
          packagingLote: source.packagingLote,
          packagingVto: source.packagingVto,
          productionPedidoId: source.productionPedidoId,
          orderId: source.orderId,
          orderNumber: source.orderNumber,
          deliveryDate: source.deliveryDate,
          status: "PUBLICADO",
          publishedAt: now,
          createdBy: actor.email,
          source: "native",
          originRef: `sched:${key}:${i}`,
          scheduleRootId: rootId,
        })
        .returning();
      createdIds.push(row.id);
      await tx.insert(operationalEvents).values({ workItemId: row.id, planningWeekId: week.id, type: "SCHEDULE_ADDED", fromStatus: null, toStatus: formatQty(items[i]!.qty), actorEmail: actor.email, actorSector: actor.sector, note: `Programación de la misma ${source.orderNumber ?? "orden"} · día ${date} · desde ${source.id} · por ${actorName}` });
      i++;
    }
    void sourceQty;
    const schedules = await summarize(tx, rootId);
    return { created: schedules.filter((s) => createdIds.includes(s.id)), replayed: false, schedules, total, programmed: plan.programmed, exceeds: plan.exceeds };
  });
}

/** Programaciones vigentes de la orden de un trabajo (incluye la original). */
export async function listSchedulesDurable(workItemId: string): Promise<{ rootId: string; schedules: ScheduleSummary[]; total: number | null } | null> {
  return getDb().transaction(async (tx: Tx) => {
    const [w] = await tx.select().from(workItems).where(eq(workItems.id, workItemId)).limit(1);
    if (!w || w.deletedAt) return null;
    const rootId: string = w.scheduleRootId ?? w.id;
    const schedules = await summarize(tx, rootId);
    const [root] = await tx.select().from(workItems).where(eq(workItems.id, rootId)).limit(1);
    return { rootId, schedules, total: parseQty(root?.scheduleTotal) };
  });
}

/**
 * Quita UNA programación (sin motivo obligatorio): soft delete del trabajo hijo, auditado. La orden (OE/OA), el pedido, el stock
 * y el resto de las programaciones no se tocan. No se puede quitar la original mientras existan otras, ni una programación con
 * avance o entregas.
 */
export async function removeScheduleDurable(workItemId: string, actor: PlanningActor): Promise<{ removed: string }> {
  assertCanSchedule(actor);
  return getDb().transaction(async (tx: Tx) => {
    const [w] = await tx.select().from(workItems).where(eq(workItems.id, workItemId)).for("update").limit(1);
    if (!w || w.deletedAt) throw new PlanningNotFoundError("Trabajo no encontrado.");
    const rootId: string = w.scheduleRootId ?? w.id;
    const group = await liveGroup(tx, rootId);
    if (group.length < 2) throw new PlanningValidationError("Esta es la única programación de la orden: para quitarla usá «Eliminar trabajo».");
    if (w.id === rootId) throw new PlanningValidationError("No se puede quitar la programación original mientras existan otras: quitá primero las demás.");
    if (w.operationalStatus !== "pendiente") throw new PlanningValidationError("Esa programación ya tiene avance: no se puede quitar.");
    const [d] = await tx.select({ n: sql<number>`count(*)::int` }).from(workItemDeliveryLines).where(eq(workItemDeliveryLines.workItemId, w.id));
    if (Number(d?.n ?? 0) > 0) throw new PlanningValidationError("Esa programación ya tiene entregas registradas: no se puede quitar.");
    const now = new Date();
    await tx.update(workItems).set({ deletedAt: now, deletedBy: actor.email, deleteReason: "Programación quitada (la orden se mantiene)", version: sql`${workItems.version} + 1`, updatedAt: now }).where(eq(workItems.id, w.id));
    await tx.insert(operationalEvents).values({ workItemId: w.id, planningWeekId: w.planningWeekId, type: "SCHEDULE_REMOVED", fromStatus: w.plannedQuantity, toStatus: null, actorEmail: actor.email, actorSector: actor.sector, note: `Programación del ${String(w.plannedDate)} quitada; ${w.orderNumber ?? "la orden"} se mantiene` });
    return { removed: w.id };
  });
}

