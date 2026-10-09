/**
 * Vínculos tarea de Semanas ↔ work item (0042) — persistencia (Neon, o memoria sin base) y reglas de escritura.
 * Solo Producción vincula, corrige o desvincula; todo queda en `semanas_task_link_events`. Nunca escribe en Google Sheets
 * ni en `work_items` (el trabajo operativo del sector no cambia). Ver `task-links.ts` para el porqué del vínculo explícito.
 */
import "server-only";

import { and, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { semanasTaskLinkEvents, semanasTaskLinks, workItems } from "@/lib/db/schema";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import type { SectorId } from "@/types/operational/sector";
import { storedPosKey } from "./priorities";
import type { PlanTask } from "./plan-tasks";
import {
  clientItemId,
  linkSectorProblem,
  linkWeekProblem,
  matchLinksToTasks,
  MIN_LINK_REASON,
  nativeItemId,
  rankCandidates,
  weekBounds,
  type LinkCandidate,
  type LinkEventDto,
  type LinkView,
  type TaskLinkRecord,
  type TaskLinksPayload,
  type WorkItemBrief,
  type WorkItemPrioritiesPayload,
  type WorkItemPriorityDto,
} from "./task-links";
export type { LinkEventDto, LinkView, TaskLinksPayload, WorkItemPrioritiesPayload, WorkItemPriorityDto };

export class LinkConflictError extends Error {
  readonly status = 409;
}
export class LinkUnavailableError extends Error {
  readonly status = 503;
}

export function canEditLinks(sector: string | null | undefined): boolean {
  return sector === "PRODUCCION";
}
export function canViewLinks(sector: string | null | undefined): boolean {
  return sector === "PRODUCCION" || sector === "DIRECCION";
}

export interface LinkActor { email: string; sector: SectorId; displayName: string }

// ---------- directorio de work items (inyectable en tests) ----------
export interface WorkItemDirectory {
  get(ids: string[]): Promise<Map<string, WorkItemBrief>>;
  /** Trabajos (no borrados) de esos sectores cuyo rango de fechas toca [from, to]. */
  list(opts: { sectors: string[]; from: string; to: string }): Promise<WorkItemBrief[]>;
}

function toBrief(r: typeof workItems.$inferSelect): WorkItemBrief {
  return {
    id: r.id, sector: r.sector, client: r.client, product: r.product, quantity: r.plannedQuantity, unit: r.unit,
    plannedDate: String(r.plannedDate), plannedDateTo: r.plannedDateTo ? String(r.plannedDateTo) : null,
    orderNumber: r.orderNumber, line: r.line, branchOwner: r.branchOwner, codificadoOriginSector: r.codificadoOriginSector,
    deleted: Boolean(r.deletedAt),
  };
}

const dbDirectory: WorkItemDirectory = {
  async get(ids) {
    if (ids.length === 0) return new Map();
    const rows = await getDb().select().from(workItems).where(inArray(workItems.id, ids));
    return new Map(rows.map((r) => [r.id, toBrief(r)] as const));
  },
  async list({ sectors, from, to }) {
    if (sectors.length === 0) return [];
    const rows = await getDb()
      .select()
      .from(workItems)
      .where(
        and(
          inArray(workItems.sector, sectors as Array<(typeof workItems.$inferSelect)["sector"]>),
          isNull(workItems.deletedAt),
          lte(workItems.plannedDate, to),
          or(gte(workItems.plannedDate, from), gte(workItems.plannedDateTo, from))
        )
      )
      .limit(500);
    return rows.map(toBrief);
  },
};

let directoryOverride: WorkItemDirectory | null = null;
export function setWorkItemDirectoryForTests(d: WorkItemDirectory | null): void {
  directoryOverride = d;
}
function directory(): WorkItemDirectory | null {
  if (directoryOverride) return directoryOverride;
  return isDatabaseConfigured() ? dbDirectory : null;
}

// ---------- persistencia ----------
interface LinkRow extends TaskLinkRecord {
  spreadsheetId: string;
  tab: string;
  unlinkedAt: string | null;
}
interface MemEvent extends LinkEventDto { spreadsheetId: string; tab: string; actorSector: string }

const g = globalThis as unknown as { __genusSemanasLinks?: { rows: LinkRow[]; events: MemEvent[] } };
function mem() {
  if (!g.__genusSemanasLinks) g.__genusSemanasLinks = { rows: [], events: [] };
  return g.__genusSemanasLinks;
}
export function resetSemanasLinksMemoryForTests(): void {
  g.__genusSemanasLinks = { rows: [], events: [] };
}

function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string }; message?: string } | null;
  return e?.code === "42P01" || e?.cause?.code === "42P01" || (/semanas_task_link/i.test(e?.message ?? "") && /does not exist/i.test(e?.message ?? ""));
}
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

function toLinkRow(r: typeof semanasTaskLinks.$inferSelect): LinkRow {
  return {
    id: r.id, spreadsheetId: r.spreadsheetId, tab: r.tab, taskKey: r.taskKey, posKey: r.posKey, taskDate: r.taskDate, summary: r.summary,
    workItemId: r.workItemId, version: r.version, linkedBy: r.linkedBy, linkedByName: r.linkedByName, createdAt: r.createdAt.toISOString(),
    unlinkedAt: r.unlinkedAt ? r.unlinkedAt.toISOString() : null,
  };
}

/** Vínculos ACTIVOS de una pestaña (o de todas las pestañas del spreadsheet si `tab` es null). */
async function activeLinks(spreadsheetId: string, tab: string | null): Promise<LinkRow[]> {
  if (!isDatabaseConfigured()) return mem().rows.filter((r) => !r.unlinkedAt && r.spreadsheetId === spreadsheetId && (tab === null || r.tab === tab));
  const where = tab === null
    ? and(eq(semanasTaskLinks.spreadsheetId, spreadsheetId), isNull(semanasTaskLinks.unlinkedAt))
    : and(eq(semanasTaskLinks.spreadsheetId, spreadsheetId), eq(semanasTaskLinks.tab, tab), isNull(semanasTaskLinks.unlinkedAt));
  return (await getDb().select().from(semanasTaskLinks).where(where)).map(toLinkRow);
}

const wiSummary = (wi: WorkItemBrief) => `${wi.product} · ${wi.client} · ${wi.quantity} ${wi.unit} · ${wi.plannedDate}${wi.orderNumber ? ` · ${wi.orderNumber}` : ""}`.slice(0, 400);
const taskSummary = (t: PlanTask) => t.lines.map((l) => l.value).join(" / ").slice(0, 400);

// ---------- lectura para Producción ----------

/** Vínculos de las tareas ACTUALES de una pestaña (para la Lista de Producción). Nunca rompe la vista. */
export async function loadTaskLinks(spreadsheetId: string, tab: string, tasks: PlanTask[]): Promise<TaskLinksPayload> {
  const dir = directory();
  if (!dir) return { available: false, byTask: {}, orphans: [] };
  try {
    const links = await activeLinks(spreadsheetId, tab);
    const items = await dir.get([...new Set(links.map((l) => l.workItemId))]);
    const { byTask, orphans } = matchLinksToTasks(tasks, links);
    const view = (l: LinkRow, task: PlanTask | null, relinked: boolean): LinkView => {
      const wi = items.get(l.workItemId) ?? null;
      const warnings = [
        !wi ? "El trabajo ya no existe." : wi.deleted ? "El trabajo fue eliminado." : null,
        wi && task ? linkSectorProblem(task.sector, wi) : null,
        wi && task ? linkWeekProblem(task.date, wi) : null,
        !task ? "La tarea ya no está en la planilla: corregí o quitá el vínculo." : null,
      ].filter((w): w is string => Boolean(w));
      return { linkId: l.id, version: l.version, workItemId: l.workItemId, workItem: wi, linkedBy: l.linkedBy, linkedByName: l.linkedByName, createdAt: l.createdAt, summary: l.summary, taskDate: l.taskDate, ...(relinked ? { relinked: true } : {}), warnings };
    };
    const out: Record<string, LinkView[]> = {};
    for (const [key, m] of byTask) {
      const task = tasks.find((t) => t.key === key) ?? null;
      out[key] = m.links.map((l) => view(l, task, m.how !== "exact"));
    }
    return { available: true, byTask: out, orphans: orphans.map((l) => view(l, null, false)) };
  } catch (err) {
    if (isMissingTable(err)) return { available: false, byTask: {}, orphans: [] };
    throw err;
  }
}

export interface LinkSuggestions {
  /** Trabajos libres de la semana y del sector, ordenados por parecido. SOLO sugerencias. */
  candidates: LinkCandidate[];
  /** Trabajos de la semana ya vinculados a OTRA tarea (para corregir un vínculo equivocado, con motivo). */
  linkedElsewhere: Array<LinkCandidate & { link: { linkId: string; version: number; taskKey: string; summary: string } }>;
}

/** Trabajos de la semana y del sector de la tarea. Nada se vincula solo: Producción elige y confirma. */
export async function suggestLinkCandidates(task: PlanTask, spreadsheetId: string): Promise<LinkSuggestions> {
  const dir = directory();
  if (!dir) throw new LinkUnavailableError("La vinculación necesita la planificación nativa (base de datos).");
  if (!task.date || !task.sector) return { candidates: [], linkedElsewhere: [] };
  const { from, to } = weekBounds(task.date);
  const sectors = task.sector.startsWith("ENVASADO") ? [task.sector, "CODIFICADO"] : [task.sector];
  const [items, links] = await Promise.all([dir.list({ sectors, from, to }), activeLinks(spreadsheetId, null).catch(() => [] as LinkRow[])]);
  const byItem = new Map(links.map((l) => [l.workItemId, l] as const));
  const linkedElsewhere = rankCandidates(task, items.filter((i) => byItem.has(i.id) && byItem.get(i.id)!.taskKey !== task.key), new Set())
    .map((c) => {
      const l = byItem.get(c.workItem.id)!;
      return { ...c, link: { linkId: l.id, version: l.version, taskKey: l.taskKey, summary: l.summary } };
    });
  return { candidates: rankCandidates(task, items, new Set(byItem.keys())), linkedElsewhere };
}

// ---------- escritura ----------
export interface LinkInput {
  spreadsheetId: string;
  tab: string;
  taskKey: string;
  workItemId: string;
  /** Si el trabajo ya está vinculado a OTRA tarea: corregir ese vínculo (con su versión). */
  replace?: { linkId: string; expectedVersion: number };
  reason?: string;
}

/**
 * Vincula UN trabajo con UNA tarea actual de la planilla. Valida en el servidor: permiso, que la tarea exista ahora,
 * que el trabajo exista, no esté borrado, sea del mismo sector y de la misma semana, y que no tenga otro vínculo activo
 * (salvo corrección explícita con versión y motivo). Registra quién, cuándo y por qué.
 */
export async function linkTask(actor: LinkActor, input: LinkInput, tasks: PlanTask[]): Promise<LinkView> {
  if (!canEditLinks(actor.sector)) throw new OrdersForbiddenError("Solo Producción puede vincular tareas de Semanas con trabajos.");
  const dir = directory();
  if (!dir) throw new LinkUnavailableError("La vinculación necesita la planificación nativa (base de datos).");
  const wid = nativeItemId(input.workItemId);
  if (!wid) throw new OrdersValidationError("Trabajo inválido: solo se vinculan trabajos de la planificación nativa.");
  const task = tasks.find((t) => t.key === input.taskKey);
  if (!task) throw new LinkConflictError("La tarea ya no está en la planilla (cambió desde que la viste). Recargá y reintentá.");
  const wi = (await dir.get([wid])).get(wid);
  if (!wi || wi.deleted) throw new OrdersValidationError("El trabajo no existe o fue eliminado.");
  const problem = linkSectorProblem(task.sector, wi) ?? linkWeekProblem(task.date, wi);
  if (problem) throw new OrdersValidationError(problem);
  const reason = (input.reason ?? "").trim();
  if (input.replace && reason.length < MIN_LINK_REASON) throw new OrdersValidationError(`Corregir un vínculo requiere un motivo (mín. ${MIN_LINK_REASON} caracteres).`);
  const now = new Date();
  const base = {
    spreadsheetId: input.spreadsheetId, tab: input.tab, taskKey: task.key, posKey: storedPosKey(task, tasks), taskDate: task.date,
    summary: taskSummary(task), workItemId: wid, linkedBy: actor.email, linkedByName: actor.displayName,
  };
  const event = (action: "LINK" | "UNLINK", taskKey: string, summary: string) => ({
    spreadsheetId: input.spreadsheetId, tab: input.tab, taskKey, workItemId: wid, action, summary, workItemSummary: wiSummary(wi),
    reason: reason || null, actorEmail: actor.email, actorSector: actor.sector, actorName: actor.displayName,
  });

  if (!isDatabaseConfigured()) {
    const m = mem();
    const cur = m.rows.find((r) => !r.unlinkedAt && r.workItemId === wid);
    if (cur && cur.taskKey === task.key && cur.spreadsheetId === input.spreadsheetId) throw new LinkConflictError("Ese trabajo ya está vinculado con esta tarea.");
    if (cur && (!input.replace || input.replace.linkId !== cur.id || input.replace.expectedVersion !== cur.version)) {
      throw new LinkConflictError("Ese trabajo ya está vinculado con otra tarea. Para corregirlo, confirmá el cambio con un motivo.");
    }
    if (cur) {
      cur.unlinkedAt = now.toISOString();
      m.events.push({ ...event("UNLINK", cur.taskKey, cur.summary), at: now.toISOString() });
    }
    const row: LinkRow = { ...base, id: `lnk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, version: 1, createdAt: now.toISOString(), unlinkedAt: null };
    m.rows.push(row);
    m.events.push({ ...event("LINK", task.key, base.summary), at: now.toISOString() });
    return { linkId: row.id, version: 1, workItemId: wid, workItem: wi, linkedBy: actor.email, linkedByName: actor.displayName, createdAt: row.createdAt, summary: row.summary, taskDate: row.taskDate, warnings: [] };
  }

  try {
    return await getDb().transaction(async (tx) => {
      const [cur] = await tx.select().from(semanasTaskLinks).where(and(eq(semanasTaskLinks.workItemId, wid), isNull(semanasTaskLinks.unlinkedAt)));
      if (cur && cur.taskKey === task.key && cur.spreadsheetId === input.spreadsheetId) throw new LinkConflictError("Ese trabajo ya está vinculado con esta tarea.");
      if (cur) {
        if (!input.replace || input.replace.linkId !== cur.id || input.replace.expectedVersion !== cur.version) {
          throw new LinkConflictError("Ese trabajo ya está vinculado con otra tarea. Para corregirlo, confirmá el cambio con un motivo.");
        }
        const res = await tx.update(semanasTaskLinks).set({ unlinkedAt: now, unlinkedBy: actor.email, updatedAt: now, version: cur.version + 1 })
          .where(and(eq(semanasTaskLinks.id, cur.id), eq(semanasTaskLinks.version, cur.version), isNull(semanasTaskLinks.unlinkedAt))).returning();
        if (res.length === 0) throw new LinkConflictError("Otro usuario cambió ese vínculo. Recargá y reintentá.");
        await tx.insert(semanasTaskLinkEvents).values(event("UNLINK", cur.taskKey, cur.summary));
      }
      const [saved] = await tx.insert(semanasTaskLinks).values(base).returning();
      await tx.insert(semanasTaskLinkEvents).values(event("LINK", task.key, base.summary));
      const r = toLinkRow(saved!);
      return { linkId: r.id, version: r.version, workItemId: wid, workItem: wi, linkedBy: r.linkedBy, linkedByName: r.linkedByName, createdAt: r.createdAt, summary: r.summary, taskDate: r.taskDate, warnings: [] };
    });
  } catch (err) {
    if (err instanceof LinkConflictError) throw err;
    if (isUniqueViolation(err)) throw new LinkConflictError("Otro usuario vinculó ese trabajo al mismo tiempo. Recargá y reintentá.");
    if (isMissingTable(err)) throw new LinkUnavailableError("La vinculación todavía no está habilitada en esta base (falta aplicar la migración 0042).");
    throw err;
  }
}

/** Quita un vínculo (lógico: la fila queda con `unlinkedAt`). Exige versión y motivo. */
export async function unlinkTask(actor: LinkActor, input: { linkId: string; expectedVersion: number; reason: string }): Promise<void> {
  if (!canEditLinks(actor.sector)) throw new OrdersForbiddenError("Solo Producción puede quitar vínculos.");
  const reason = (input.reason ?? "").trim();
  if (reason.length < MIN_LINK_REASON) throw new OrdersValidationError(`Quitar un vínculo requiere un motivo (mín. ${MIN_LINK_REASON} caracteres).`);
  const now = new Date();
  const dir = directory();
  if (!isDatabaseConfigured()) {
    const m = mem();
    const cur = m.rows.find((r) => r.id === input.linkId);
    if (!cur || cur.unlinkedAt) throw new LinkConflictError("El vínculo ya no existe. Recargá.");
    if (cur.version !== input.expectedVersion) throw new LinkConflictError("Otro usuario cambió ese vínculo. Recargá y reintentá.");
    const wi = (await dir?.get([cur.workItemId]))?.get(cur.workItemId);
    cur.unlinkedAt = now.toISOString();
    cur.version += 1;
    m.events.push({ spreadsheetId: cur.spreadsheetId, tab: cur.tab, taskKey: cur.taskKey, workItemId: cur.workItemId, action: "UNLINK", summary: cur.summary, workItemSummary: wi ? wiSummary(wi) : "", reason, actorEmail: actor.email, actorSector: actor.sector, actorName: actor.displayName, at: now.toISOString() });
    return;
  }
  try {
    await getDb().transaction(async (tx) => {
      const res = await tx.update(semanasTaskLinks).set({ unlinkedAt: now, unlinkedBy: actor.email, updatedAt: now, version: input.expectedVersion + 1 })
        .where(and(eq(semanasTaskLinks.id, input.linkId), eq(semanasTaskLinks.version, input.expectedVersion), isNull(semanasTaskLinks.unlinkedAt))).returning();
      if (res.length === 0) throw new LinkConflictError("Otro usuario cambió o quitó ese vínculo. Recargá y reintentá.");
      const cur = res[0]!;
      const wi = (await dir?.get([cur.workItemId]))?.get(cur.workItemId);
      await tx.insert(semanasTaskLinkEvents).values({ spreadsheetId: cur.spreadsheetId, tab: cur.tab, taskKey: cur.taskKey, workItemId: cur.workItemId, action: "UNLINK", summary: cur.summary, workItemSummary: wi ? wiSummary(wi) : "", reason, actorEmail: actor.email, actorSector: actor.sector, actorName: actor.displayName });
    });
  } catch (err) {
    if (err instanceof LinkConflictError) throw err;
    if (isMissingTable(err)) throw new LinkUnavailableError("La vinculación todavía no está habilitada en esta base (falta aplicar la migración 0042).");
    throw err;
  }
}

/** Historial de vínculos de una tarea (y de los trabajos que tuvo vinculados). Más reciente primero. */
export async function listLinkEvents(spreadsheetId: string, tab: string, taskKey: string): Promise<LinkEventDto[]> {
  if (!isDatabaseConfigured()) {
    return mem().events.filter((e) => e.spreadsheetId === spreadsheetId && e.tab === tab && e.taskKey === taskKey)
      .map(({ action, taskKey: k, workItemId, summary, workItemSummary, reason, actorEmail, actorName, at }) => ({ action, taskKey: k, workItemId, summary, workItemSummary, reason, actorEmail, actorName, at }))
      .reverse().slice(0, 50);
  }
  try {
    const rows = await getDb().select().from(semanasTaskLinkEvents)
      .where(and(eq(semanasTaskLinkEvents.spreadsheetId, spreadsheetId), eq(semanasTaskLinkEvents.tab, tab), eq(semanasTaskLinkEvents.taskKey, taskKey)))
      .orderBy(desc(semanasTaskLinkEvents.createdAt)).limit(50);
    return rows.map((r) => ({ action: r.action === "UNLINK" ? "UNLINK" : "LINK", taskKey: r.taskKey, workItemId: r.workItemId, summary: r.summary, workItemSummary: r.workItemSummary, reason: r.reason, actorEmail: r.actorEmail, actorName: r.actorName, at: r.createdAt.toISOString() }));
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/** Tras corregir texto desde GENUS: re-asocia (texto corregido / traslado inequívoco) las claves de los vínculos. */
export async function reconcileLinks(spreadsheetId: string, tab: string, tasks: PlanTask[]): Promise<number> {
  try {
    if (!directory()) return 0;
    const links = await activeLinks(spreadsheetId, tab);
    const { byTask } = matchLinksToTasks(tasks, links);
    let moved = 0;
    for (const [key, m] of byTask) {
      if (m.how === "exact") continue;
      const t = tasks.find((x) => x.key === key)!;
      const next = { taskKey: t.key, posKey: storedPosKey(t, tasks), taskDate: t.date };
      for (const l of m.links) {
        if (!isDatabaseConfigured()) {
          const row = mem().rows.find((r) => r.id === l.id);
          if (row) { Object.assign(row, next); moved += 1; }
        } else {
          await getDb().update(semanasTaskLinks).set({ ...next, updatedAt: new Date() }).where(eq(semanasTaskLinks.id, l.id));
          moved += 1;
        }
      }
    }
    return moved;
  } catch {
    return 0;
  }
}

// ---------- prioridad por work item («Mi trabajo») ----------

/**
 * Prioridades de Semanas de los trabajos que el usuario puede ver: su propio sector (Producción y Dirección: todos).
 * `loadTasks(tab)` devuelve las tareas ACTUALES con prioridad (misma proyección que Semanas / TV). Si la tarea del
 * vínculo ya no está, el trabajo no muestra prioridad: nunca se muestra una prioridad dudosa.
 */
export async function loadWorkItemPriorities(
  viewer: SectorId,
  spreadsheetId: string,
  loadTasks: (tab: string) => Promise<PlanTask[]>
): Promise<WorkItemPrioritiesPayload> {
  const dir = directory();
  if (!dir) return { available: false, byWorkItem: {} };
  let links: LinkRow[];
  try {
    links = await activeLinks(spreadsheetId, null);
  } catch (err) {
    if (isMissingTable(err)) return { available: false, byWorkItem: {} };
    throw err;
  }
  if (links.length === 0) return { available: true, byWorkItem: {} };
  const items = await dir.get([...new Set(links.map((l) => l.workItemId))]);
  const all = canViewLinks(viewer);
  const visible = links.filter((l) => {
    const wi = items.get(l.workItemId);
    return wi && !wi.deleted && (all || wi.sector === viewer);
  });
  const byWorkItem: Record<string, WorkItemPriorityDto> = {};
  for (const tab of new Set(visible.map((l) => l.tab))) {
    const tasks = await loadTasks(tab);
    const { byTask } = matchLinksToTasks(tasks, visible.filter((l) => l.tab === tab));
    for (const [key, m] of byTask) {
      const t = tasks.find((x) => x.key === key)!;
      for (const l of m.links) {
        byWorkItem[clientItemId(l.workItemId)] = { priority: t.priority, priorityInfo: t.priorityInfo, taskKey: t.key, taskProducts: t.products, taskClient: t.client, taskDate: t.date };
      }
    }
  }
  return { available: true, byWorkItem };
}
