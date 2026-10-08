/**
 * Prioridad operativa de las tareas de Semanas — persistencia (Neon, con memoria si no hay base) y reglas de escritura.
 * UNA sola tabla (0041 + columnas de enlace 0042) compartida por Producción → Semanas y por las tareas de cada sector.
 * NUNCA escribe en Google Sheets. La lectura/sincronización de la planilla no toca estas tablas, así que no puede
 * borrar prioridades. La asociación con las tareas es solo inequívoca (ver priorities.ts / calendar-tasks.ts).
 */
import "server-only";

import { and, eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { semanasTaskPriorities, semanasTaskPriorityEvents } from "@/lib/db/schema";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import type { SectorId } from "@/types/operational/sector";
import { buildCalendarModel, taskLinkFields, type CalendarTask } from "./calendar-tasks";
import type { CalendarWeek } from "./calendar-model";
import { canEditPriorities } from "./priorities-permissions";
import { DEFAULT_PRIORITY, isPriority, matchPriorities, type PrioritiesPayload, type Priority, type PriorityRow, type StoredPriority } from "./priorities";

export type { PrioritiesPayload };
export { canEditPriorities };

export class PriorityConflictError extends Error {
  readonly status = 409;
}
export class PriorityUnavailableError extends Error {
  readonly status = 503;
}

/** Fila guardada con sus datos de enlace (para que los sectores reconozcan la misma tarea). */
export interface LinkedPriorityRow extends PriorityRow {
  spreadsheetId: string;
  tab: string;
  summary: string;
  taskDate: string | null;
  taskDateTo: string | null;
  clientNorm: string | null;
  productsNorm: string[];
  sectionNorm: string | null;
}
interface EventRow {
  spreadsheetId: string; tab: string; taskKey: string; summary: string; from: Priority; to: Priority;
  actorEmail: string; actorSector: string; actorName: string; at: string;
}
const g = globalThis as unknown as { __genusSemanasPriorities?: { rows: LinkedPriorityRow[]; events: EventRow[] } };
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
  return e?.code === "42P01" || e?.cause?.code === "42P01" || (/semanas_task_priorit/i.test(e?.message ?? "") && /does not exist/i.test(e?.message ?? ""));
}
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

function toRow(r: typeof semanasTaskPriorities.$inferSelect): LinkedPriorityRow {
  return {
    spreadsheetId: r.spreadsheetId, tab: r.tab, taskKey: r.taskKey, posKey: r.posKey, summary: r.summary, taskDate: r.taskDate, taskDateTo: r.taskDateTo ?? r.taskDate,
    clientNorm: r.clientNorm, productsNorm: Array.isArray(r.productsNorm) ? r.productsNorm : [], sectionNorm: r.sectionNorm,
    priority: isPriority(r.priority) ? r.priority : DEFAULT_PRIORITY, version: r.version,
    updatedBy: r.updatedBy, updatedByName: r.updatedByName, updatedAt: r.updatedAt.toISOString(),
  };
}

/** Todas las filas de un spreadsheet (opcionalmente de una pestaña). La tabla solo guarda tareas que alguien priorizó. */
export async function listPriorityRows(spreadsheetId: string, tab?: string): Promise<LinkedPriorityRow[]> {
  if (!isDatabaseConfigured()) return mem().rows.filter((r) => r.spreadsheetId === spreadsheetId && (!tab || r.tab === tab));
  const where = tab
    ? and(eq(semanasTaskPriorities.spreadsheetId, spreadsheetId), eq(semanasTaskPriorities.tab, tab))
    : eq(semanasTaskPriorities.spreadsheetId, spreadsheetId);
  return (await getDb().select().from(semanasTaskPriorities).where(where)).map(toRow);
}

const allTasks = (weeks: CalendarWeek[], tab: string) =>
  buildCalendarModel(weeks, tab).flatMap((w) => w.sections.flatMap((s) => s.tasks.map((t) => ({ task: t, sectionTitle: s.title?.value ?? null }))));

/** Prioridades de las tareas actuales de una pestaña. Nunca falla la vista: sin tabla → `available:false`. */
export async function loadPriorities(spreadsheetId: string, tab: string, weeks: CalendarWeek[]): Promise<PrioritiesPayload> {
  const tasks = allTasks(weeks, tab).map((x) => x.task);
  try {
    const rows = await listPriorityRows(spreadsheetId, tab);
    const matched = matchPriorities(tasks, rows);
    for (const k of Object.keys(matched)) delete matched[k]!.rowTaskKey; // detalle interno: no sale al cliente
    return { byTask: matched, available: true };
  } catch {
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
  const entries = allTasks(weeks, input.tab);
  const entry = entries.find((x) => x.task.key === input.taskKey);
  if (!entry) throw new PriorityConflictError("La tarea ya no está en la planilla (cambió desde que la viste). Recargá y reintentá.");
  const task = entry.task;
  const link = taskLinkFields(task, entry.sectionTitle);
  const now = new Date();
  const { spreadsheetId, tab } = input;
  const tasks = entries.map((x) => x.task);
  const staleMsg = "Otro usuario cambió la prioridad de esta tarea. Recargá y reintentá.";

  if (!isDatabaseConfigured()) {
    const m = mem();
    const rows = m.rows.filter((r) => r.spreadsheetId === spreadsheetId && r.tab === tab);
    const rowKey = matchPriorities(tasks, rows)[task.key]?.rowTaskKey ?? task.key;
    const cur = rows.find((r) => r.taskKey === rowKey);
    const curVersion = cur?.version ?? 0;
    if (curVersion !== input.expectedVersion) throw new PriorityConflictError(staleMsg);
    const from = cur?.priority ?? DEFAULT_PRIORITY;
    const next: LinkedPriorityRow = {
      spreadsheetId, tab, taskKey: task.key, posKey: task.posKey, summary: summaryOf(task), ...link, taskDate: link.taskDate, taskDateTo: link.taskDateTo,
      clientNorm: link.clientNorm, productsNorm: link.productsNorm, sectionNorm: link.sectionNorm,
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
      const raw = await tx.select().from(semanasTaskPriorities).where(and(eq(semanasTaskPriorities.spreadsheetId, spreadsheetId), eq(semanasTaskPriorities.tab, tab)));
      const rows = raw.map(toRow);
      const rowKey = matchPriorities(tasks, rows)[task.key]?.rowTaskKey ?? task.key;
      const cur = raw.find((r) => r.taskKey === rowKey);
      const curVersion = cur?.version ?? 0;
      if (curVersion !== input.expectedVersion) throw new PriorityConflictError(staleMsg);
      const from = cur && isPriority(cur.priority) ? cur.priority : DEFAULT_PRIORITY;
      const values = {
        taskKey: task.key, posKey: task.posKey, taskDate: link.taskDate, taskDateTo: link.taskDateTo, clientNorm: link.clientNorm, productsNorm: link.productsNorm, sectionNorm: link.sectionNorm,
        summary: summaryOf(task), priority: input.priority, version: curVersion + 1,
        updatedBy: actor.email, updatedBySector: actor.sector, updatedByName: actor.displayName, updatedAt: now,
      };
      let saved: typeof semanasTaskPriorities.$inferSelect;
      if (cur) {
        // CAS por versión: si otra transacción ganó, 0 filas → conflicto.
        const res = await tx.update(semanasTaskPriorities).set(values).where(and(eq(semanasTaskPriorities.id, cur.id), eq(semanasTaskPriorities.version, cur.version))).returning();
        if (res.length === 0) throw new PriorityConflictError(staleMsg);
        saved = res[0]!;
      } else {
        const res = await tx.insert(semanasTaskPriorities).values({ spreadsheetId, tab, ...values }).returning();
        saved = res[0]!;
      }
      await tx.insert(semanasTaskPriorityEvents).values({ spreadsheetId, tab, taskKey: task.key, summary: values.summary, fromPriority: from, toPriority: input.priority, actorEmail: actor.email, actorSector: actor.sector, actorName: actor.displayName });
      const r = toRow(saved);
      return { priority: r.priority, version: r.version, updatedBy: r.updatedBy, updatedByName: r.updatedByName, updatedAt: r.updatedAt };
    });
  } catch (err) {
    if (err instanceof PriorityConflictError) throw err;
    if (isUniqueViolation(err)) throw new PriorityConflictError(staleMsg);
    if (isMissingTable(err)) throw new PriorityUnavailableError("Las prioridades todavía no están habilitadas en esta base (falta aplicar la migración 0041).");
    throw err;
  }
}

/** Clave de la tarea que contiene cada celda (A1) en la planilla actual. */
export function taskKeysByCell(weeks: CalendarWeek[], tab: string, a1s: string[]): Record<string, string> {
  const want = new Set(a1s.map((a) => a.toUpperCase()));
  const out: Record<string, string> = {};
  for (const { task } of allTasks(weeks, tab)) for (const l of task.lines) if (want.has(l.a1)) out[l.a1] = task.key;
  return out;
}

/**
 * Re-asocia prioridades de forma EXPLÍCITA tras una corrección hecha desde GENUS:
 *  - `edited` = {A1 → clave de la tarea ANTES de editar}; si ahora esa celda pertenece a una tarea con otra clave
 *    (porque se corrigió el texto), la fila guardada pasa a la clave nueva (con registro en el historial);
 *  - las tareas que cambiaron de día de forma inequívoca (matchPriorities → relinked) se persisten con su clave nueva.
 * Nunca asigna por posición ni a una tarea que ya tiene su propia fila. Idempotente y de mejor esfuerzo.
 */
export async function reconcilePriorities(spreadsheetId: string, tab: string, weeks: CalendarWeek[], edited: Record<string, string> = {}, actor?: PriorityActor): Promise<number> {
  try {
    const entries = allTasks(weeks, tab);
    const tasks = entries.map((x) => x.task);
    const rows = await listPriorityRows(spreadsheetId, tab);
    const have = new Set(rows.map((r) => r.taskKey));
    const moves = new Map<string, string>(); // clave guardada → clave nueva
    const nowKeyOfCell = taskKeysByCell(weeks, tab, Object.keys(edited));
    for (const [a1, oldKey] of Object.entries(edited)) {
      const newKey = nowKeyOfCell[a1.toUpperCase()];
      if (newKey && newKey !== oldKey && have.has(oldKey) && !have.has(newKey) && !moves.has(oldKey)) moves.set(oldKey, newKey);
    }
    const matched = matchPriorities(tasks, rows);
    for (const [key, m] of Object.entries(matched)) if (m.relinked && m.rowTaskKey && !moves.has(m.rowTaskKey)) moves.set(m.rowTaskKey, key);
    let moved = 0;
    for (const [from, to] of moves) {
      const entry = entries.find((x) => x.task.key === to);
      if (!entry) continue;
      const link = taskLinkFields(entry.task, entry.sectionTitle);
      const patch = { taskKey: to, posKey: entry.task.posKey, summary: summaryOf(entry.task), taskDate: link.taskDate, taskDateTo: link.taskDateTo, clientNorm: link.clientNorm, productsNorm: link.productsNorm, sectionNorm: link.sectionNorm };
      const row = rows.find((r) => r.taskKey === from);
      if (!row) continue;
      if (!isDatabaseConfigured()) {
        const mr = mem().rows.find((r) => r.spreadsheetId === spreadsheetId && r.tab === tab && r.taskKey === from);
        if (mr) Object.assign(mr, patch);
        mem().events.push({ spreadsheetId, tab, taskKey: to, summary: `Re-asociada: ${patch.summary}`, from: row.priority, to: row.priority, actorEmail: actor?.email ?? "sistema", actorSector: actor?.sector ?? "SISTEMA", actorName: actor?.displayName ?? "Sistema", at: new Date().toISOString() });
      } else {
        await getDb().transaction(async (tx) => {
          await tx.update(semanasTaskPriorities).set(patch).where(and(eq(semanasTaskPriorities.spreadsheetId, spreadsheetId), eq(semanasTaskPriorities.tab, tab), eq(semanasTaskPriorities.taskKey, from)));
          await tx.insert(semanasTaskPriorityEvents).values({ spreadsheetId, tab, taskKey: to, summary: `Re-asociada: ${patch.summary}`.slice(0, 400), fromPriority: row.priority, toPriority: row.priority, actorEmail: actor?.email ?? "sistema", actorSector: actor?.sector ?? "SISTEMA", actorName: actor?.displayName ?? "Sistema" });
        });
      }
      moved += 1;
    }
    return moved;
  } catch {
    return 0;
  }
}
