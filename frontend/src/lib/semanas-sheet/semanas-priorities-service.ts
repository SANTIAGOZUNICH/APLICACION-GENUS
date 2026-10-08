/**
 * Prioridad operativa de las tareas de Semanas — persistencia (Neon, con memoria si no hay base) y reglas de escritura.
 * NUNCA escribe en Google Sheets. Sobrevive a la lectura/sincronización de la planilla porque vive en tablas propias
 * (0041) y se asocia a las tareas por contenido+fecha (ver calendar-tasks.ts), no por n° de fila.
 */
import "server-only";

import { and, eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { semanasTaskPriorities, semanasTaskPriorityEvents } from "@/lib/db/schema";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import type { SectorId } from "@/types/operational/sector";
import { buildCalendarModel, type CalendarTask } from "./calendar-tasks";
import type { CalendarWeek } from "./calendar-model";
import { DEFAULT_PRIORITY, isPriority, matchPriorities, type Priority, type PriorityRow, type StoredPriority } from "./priorities";

export class PriorityConflictError extends Error {
  readonly status = 409;
}
export class PriorityUnavailableError extends Error {
  readonly status = 503;
}

export function canEditPriorities(sector: SectorId | null | undefined): boolean {
  return sector === "PRODUCCION";
}

interface Row extends PriorityRow {
  spreadsheetId: string;
  tab: string;
  summary: string;
  taskDate: string | null;
}
interface EventRow {
  spreadsheetId: string; tab: string; taskKey: string; summary: string; from: Priority; to: Priority;
  actorEmail: string; actorSector: string; actorName: string; at: string;
}
const g = globalThis as unknown as { __genusSemanasPriorities?: { rows: Row[]; events: EventRow[] } };
function mem() {
  if (!g.__genusSemanasPriorities) g.__genusSemanasPriorities = { rows: [], events: [] };
  return g.__genusSemanasPriorities;
}
export function resetSemanasPrioritiesMemoryForTests(): void {
  g.__genusSemanasPriorities = { rows: [], events: [] };
}
export function getSemanasPriorityEventsMemory(): EventRow[] {
  return mem().events;
}

function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string }; message?: string } | null;
  return e?.code === "42P01" || e?.cause?.code === "42P01" || /semanas_task_priorit/i.test(e?.message ?? "") && /does not exist/i.test(e?.message ?? "");
}
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

function toPriorityRow(r: typeof semanasTaskPriorities.$inferSelect): Row {
  return {
    spreadsheetId: r.spreadsheetId, tab: r.tab, taskKey: r.taskKey, posKey: r.posKey, summary: r.summary, taskDate: r.taskDate,
    priority: isPriority(r.priority) ? r.priority : DEFAULT_PRIORITY, version: r.version,
    updatedBy: r.updatedBy, updatedByName: r.updatedByName, updatedAt: r.updatedAt.toISOString(),
  };
}

async function listRows(spreadsheetId: string, tab: string): Promise<Row[]> {
  if (!isDatabaseConfigured()) return mem().rows.filter((r) => r.spreadsheetId === spreadsheetId && r.tab === tab);
  const rows = await getDb().select().from(semanasTaskPriorities).where(and(eq(semanasTaskPriorities.spreadsheetId, spreadsheetId), eq(semanasTaskPriorities.tab, tab)));
  return rows.map(toPriorityRow);
}

export interface PrioritiesPayload {
  /** Prioridades por clave de tarea ACTUAL (ausente = NORMAL). */
  byTask: Record<string, StoredPriority>;
  /** false = la tabla todavía no existe (migración 0041 pendiente): se muestra NORMAL y no se puede guardar. */
  available: boolean;
}

/** Prioridades de las tareas actuales de una pestaña. Nunca falla la vista: sin tabla → `available:false`. */
export async function loadPriorities(spreadsheetId: string, tab: string, weeks: CalendarWeek[]): Promise<PrioritiesPayload> {
  const tasks = buildCalendarModel(weeks, tab).flatMap((w) => w.sections.flatMap((s) => s.tasks));
  try {
    const rows = await listRows(spreadsheetId, tab);
    return { byTask: matchPriorities(tasks, rows), available: true };
  } catch (err) {
    if (isMissingTable(err)) return { byTask: {}, available: false };
    return { byTask: {}, available: false };
  }
}

function summaryOf(task: CalendarTask): string {
  return task.lines.map((l) => l.value).join(" / ").slice(0, 400);
}

export interface SetPriorityInput {
  spreadsheetId: string;
  tab: string;
  taskKey: string;
  priority: Priority;
  /** `version` que el cliente vio (0 = sin registro previo). */
  expectedVersion: number;
}
export interface PriorityActor { email: string; sector: SectorId; displayName: string }

/**
 * Cambia la prioridad de UNA tarea. `weeks` = lectura VIVA de la planilla: la tarea tiene que existir ahora
 * (si la planilla cambió, se informa y no se guarda). Control de concurrencia por `version`. Registra quién y cuándo.
 */
export async function setTaskPriority(actor: PriorityActor, input: SetPriorityInput, weeks: CalendarWeek[]): Promise<StoredPriority> {
  if (!canEditPriorities(actor.sector)) throw new OrdersForbiddenError("Solo Producción puede cambiar prioridades.");
  if (!isPriority(input.priority)) throw new OrdersValidationError("Prioridad inválida (URGENTE, IMPORTANTE o NORMAL).");
  const tasks = buildCalendarModel(weeks, input.tab).flatMap((w) => w.sections.flatMap((s) => s.tasks));
  const task = tasks.find((t) => t.key === input.taskKey);
  if (!task) throw new PriorityConflictError("La tarea ya no está en la planilla (cambió desde que la viste). Recargá y reintentá.");
  const now = new Date();
  const { spreadsheetId, tab } = input;

  if (!isDatabaseConfigured()) {
    const m = mem();
    const cur = m.rows.find((r) => r.spreadsheetId === spreadsheetId && r.tab === tab && r.taskKey === task.key)
      // tarea corregida: la fila guardada por posición (ya no coincide con ninguna tarea actual)
      ?? m.rows.find((r) => r.spreadsheetId === spreadsheetId && r.tab === tab && r.posKey === task.posKey && !tasks.some((t) => t.key === r.taskKey));
    const curVersion = cur?.version ?? 0;
    if (curVersion !== input.expectedVersion) throw new PriorityConflictError("Otro usuario cambió la prioridad de esta tarea. Recargá y reintentá.");
    const from = cur?.priority ?? DEFAULT_PRIORITY;
    const next: Row = {
      spreadsheetId, tab, taskKey: task.key, posKey: task.posKey, summary: summaryOf(task), taskDate: task.date,
      priority: input.priority, version: curVersion + 1, updatedBy: actor.email, updatedByName: actor.displayName, updatedAt: now.toISOString(),
    };
    if (cur) Object.assign(cur, next);
    else m.rows.push(next);
    m.events.push({ spreadsheetId, tab, taskKey: task.key, summary: next.summary, from, to: input.priority, actorEmail: actor.email, actorSector: actor.sector, actorName: actor.displayName, at: next.updatedAt });
    return { priority: next.priority, version: next.version, updatedBy: next.updatedBy, updatedByName: next.updatedByName, updatedAt: next.updatedAt };
  }

  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      const rows = await tx.select().from(semanasTaskPriorities).where(and(eq(semanasTaskPriorities.spreadsheetId, spreadsheetId), eq(semanasTaskPriorities.tab, tab)));
      const live = new Set(tasks.map((t) => t.key));
      const cur = rows.find((r) => r.taskKey === task.key) ?? rows.find((r) => r.posKey === task.posKey && !live.has(r.taskKey));
      const curVersion = cur?.version ?? 0;
      if (curVersion !== input.expectedVersion) throw new PriorityConflictError("Otro usuario cambió la prioridad de esta tarea. Recargá y reintentá.");
      const from = cur && isPriority(cur.priority) ? cur.priority : DEFAULT_PRIORITY;
      const values = {
        taskKey: task.key, posKey: task.posKey, taskDate: task.date, summary: summaryOf(task), priority: input.priority,
        version: curVersion + 1, updatedBy: actor.email, updatedBySector: actor.sector, updatedByName: actor.displayName, updatedAt: now,
      };
      let saved: typeof semanasTaskPriorities.$inferSelect;
      if (cur) {
        // CAS por versión: si otra transacción ganó, 0 filas → conflicto.
        const res = await tx.update(semanasTaskPriorities).set(values).where(and(eq(semanasTaskPriorities.id, cur.id), eq(semanasTaskPriorities.version, cur.version))).returning();
        if (res.length === 0) throw new PriorityConflictError("Otro usuario cambió la prioridad de esta tarea. Recargá y reintentá.");
        saved = res[0]!;
      } else {
        const res = await tx.insert(semanasTaskPriorities).values({ spreadsheetId, tab, ...values }).returning();
        saved = res[0]!;
      }
      await tx.insert(semanasTaskPriorityEvents).values({ spreadsheetId, tab, taskKey: task.key, summary: values.summary, fromPriority: from, toPriority: input.priority, actorEmail: actor.email, actorSector: actor.sector, actorName: actor.displayName });
      const r = toPriorityRow(saved);
      return { priority: r.priority, version: r.version, updatedBy: r.updatedBy, updatedByName: r.updatedByName, updatedAt: r.updatedAt };
    });
  } catch (err) {
    if (err instanceof PriorityConflictError) throw err;
    if (isUniqueViolation(err)) throw new PriorityConflictError("Otro usuario cambió la prioridad de esta tarea. Recargá y reintentá.");
    if (isMissingTable(err)) throw new PriorityUnavailableError("Las prioridades todavía no están habilitadas en esta base (falta aplicar la migración 0041).");
    throw err;
  }
}

/**
 * Tras corregir el texto de una tarea desde GENUS: re-asocia (por posición) las prioridades cuyo contenido cambió,
 * para que la clave guardada vuelva a coincidir con la tarea. Idempotente y de mejor esfuerzo.
 */
export async function reconcilePriorities(spreadsheetId: string, tab: string, weeks: CalendarWeek[]): Promise<number> {
  try {
    const tasks = buildCalendarModel(weeks, tab).flatMap((w) => w.sections.flatMap((s) => s.tasks));
    const rows = await listRows(spreadsheetId, tab);
    const matched = matchPriorities(tasks, rows);
    let moved = 0;
    for (const t of tasks) {
      const m = matched[t.key];
      if (!m?.relinked) continue;
      const orphan = rows.find((r) => r.posKey === t.posKey && r.taskKey !== t.key && !tasks.some((x) => x.key === r.taskKey));
      if (!orphan) continue;
      if (!isDatabaseConfigured()) {
        const row = mem().rows.find((r) => r === (orphan as Row) || (r.spreadsheetId === spreadsheetId && r.tab === tab && r.taskKey === orphan.taskKey));
        if (row) { row.taskKey = t.key; row.posKey = t.posKey; row.summary = summaryOf(t); row.taskDate = t.date; moved += 1; }
      } else {
        await getDb().update(semanasTaskPriorities).set({ taskKey: t.key, posKey: t.posKey, summary: summaryOf(t), taskDate: t.date })
          .where(and(eq(semanasTaskPriorities.spreadsheetId, spreadsheetId), eq(semanasTaskPriorities.tab, tab), eq(semanasTaskPriorities.taskKey, orphan.taskKey)));
        moved += 1;
      }
    }
    return moved;
  } catch {
    return 0;
  }
}
