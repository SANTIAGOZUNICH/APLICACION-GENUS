/**
 * Vínculo EXPLÍCITO entre una tarea de Semanas y un trabajo operativo (work item) — reglas PURAS (cliente y servidor).
 *
 * Por qué es explícito: SEMANAS 2026 no tiene OE/OA, pedido ni lote (verificado sobre las 1.454 líneas de tareas de la
 * copia del libro) y `work_items` no guarda la celda de origen (se crean desde la asignación de Producción). No existe una
 * relación inequívoca, así que la confirma Producción. Las coincidencias de fecha / cliente / producto solo se usan para
 * ORDENAR sugerencias: nunca se vincula nada automáticamente.
 *
 * El vínculo sigue a la tarea con las MISMAS reglas que la prioridad (`matchPriorityRows`): misma clave, texto corregido
 * inequívoco o traslado de día inequívoco. Si la tarea desaparece de la planilla, el vínculo queda «sin tarea» (no se
 * reasigna a otra) y el trabajo no muestra prioridad hasta que Producción lo corrija.
 */
import { matchPriorityRows, type Priority, type PriorityMatchKind, type StoredPriority } from "./priorities";
import type { PlanSector, PlanTask } from "./plan-tasks";

export interface TaskLinkRecord {
  id: string;
  taskKey: string;
  posKey: string;
  workItemId: string;
  version: number;
  linkedBy: string;
  linkedByName: string;
  createdAt: string;
  /** Texto de la tarea al vincular (para mostrar un vínculo cuya tarea ya no está). */
  summary: string;
  taskDate: string | null;
}

/** Datos mínimos de un work item para vincular y mostrar (sin el resto del registro operativo). */
export interface WorkItemBrief {
  /** uuid nativo (sin el prefijo `native:` que usa el cliente). */
  id: string;
  sector: string;
  client: string;
  product: string;
  quantity: string;
  unit: string;
  plannedDate: string;
  plannedDateTo: string | null;
  orderNumber: string | null;
  line: string | null;
  branchOwner: string | null;
  codificadoOriginSector: string | null;
  deleted: boolean;
}

/** Id que usa el cliente para un work item nativo. */
export const NATIVE_ITEM_PREFIX = "native:";
export function clientItemId(nativeId: string): string {
  return `${NATIVE_ITEM_PREFIX}${nativeId}`;
}
export function nativeItemId(id: string): string | null {
  const raw = id.startsWith(NATIVE_ITEM_PREFIX) ? id.slice(NATIVE_ITEM_PREFIX.length) : id;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) ? raw.toLowerCase() : null;
}

/**
 * Agrupa los vínculos activos por tarea y los asocia a las tareas ACTUALES. Una tarea puede tener varios trabajos
 * (p. ej. una elaboración con dos productos); un trabajo, a lo sumo una tarea.
 */
export function matchLinksToTasks<L extends Pick<TaskLinkRecord, "taskKey" | "posKey">>(
  tasks: Array<{ key: string; posKey: string }>,
  links: L[]
): { byTask: Map<string, { links: L[]; how: PriorityMatchKind }>; orphans: L[] } {
  const groups = new Map<string, { taskKey: string; posKey: string; links: L[] }>();
  for (const l of links) {
    const g = groups.get(l.taskKey);
    if (g) g.links.push(l);
    else groups.set(l.taskKey, { taskKey: l.taskKey, posKey: l.posKey, links: [l] });
  }
  const matched = matchPriorityRows(tasks, [...groups.values()]);
  const byTask = new Map<string, { links: L[]; how: PriorityMatchKind }>();
  const used = new Set<string>();
  for (const [key, { row, how }] of matched) {
    byTask.set(key, { links: row.links, how });
    used.add(row.taskKey);
  }
  const orphans = [...groups.values()].filter((g) => !used.has(g.taskKey)).flatMap((g) => g.links);
  return { byTask, orphans };
}

/**
 * ¿Ese trabajo puede corresponder a esa tarea? Mismo sector; o un trabajo que pasó a Codificado desde ese sector
 * de envasado (el mismo work item cambia de sector al enviarse a Codificado y conserva el vínculo).
 */
export function linkSectorProblem(taskSector: PlanSector | null, wi: Pick<WorkItemBrief, "sector" | "codificadoOriginSector">): string | null {
  if (!taskSector) return "La tarea no pertenece a un sector identificable de la planilla.";
  if (wi.sector === taskSector) return null;
  if (wi.sector === "CODIFICADO" && wi.codificadoOriginSector === taskSector) return null;
  return "El trabajo es de otro sector que la tarea.";
}

/** Lunes y domingo ISO de la semana que contiene `iso`. */
export function weekBounds(iso: string): { from: string; to: string } {
  const d = new Date(`${iso}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() - dow);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  return { from: mon.toISOString().slice(0, 10), to: sun.toISOString().slice(0, 10) };
}

/** El trabajo tiene que estar planificado en la MISMA semana que la tarea (otra semana = otra planificación). */
export function linkWeekProblem(taskDate: string | null, wi: Pick<WorkItemBrief, "plannedDate" | "plannedDateTo">): string | null {
  if (!taskDate) return "La tarea no tiene una fecha interpretable en la planilla.";
  const { from, to } = weekBounds(taskDate);
  const end = wi.plannedDateTo ?? wi.plannedDate;
  return wi.plannedDate <= to && end >= from ? null : "El trabajo está planificado en otra semana.";
}

const fold = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const STOP = new Set(["crema", "gel", "kg", "lt", "ml", "x", "con", "de", "del", "la", "el", "y", "en", "para", "total"]);
function tokens(v: string): Set<string> {
  return new Set(fold(v).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t)));
}

export interface LinkCandidate {
  workItem: WorkItemBrief;
  /** Coincidencias que se muestran a Producción (NO deciden nada). */
  hints: Array<"MISMO_DIA" | "CLIENTE" | "PRODUCTO">;
  score: number;
}

/**
 * Trabajos de la misma semana y sector, ordenados por parecido. SOLO sugerencias: Producción elige y confirma.
 * Se excluyen los borrados, los de otro sector u otra semana y los que ya tienen un vínculo activo.
 */
export function rankCandidates(task: Pick<PlanTask, "sector" | "date" | "endDate" | "client" | "products">, items: WorkItemBrief[], linkedIds: Set<string>): LinkCandidate[] {
  const clientTokens = tokens(task.client ?? "");
  const productTokens = tokens(task.products.join(" "));
  const out: LinkCandidate[] = [];
  for (const wi of items) {
    if (wi.deleted || linkedIds.has(wi.id) || linkSectorProblem(task.sector, wi) || linkWeekProblem(task.date, wi)) continue;
    const hints: LinkCandidate["hints"] = [];
    const end = wi.plannedDateTo ?? wi.plannedDate;
    if (task.date && wi.plannedDate <= (task.endDate ?? task.date) && end >= task.date) hints.push("MISMO_DIA");
    const wc = tokens(wi.client);
    if (clientTokens.size && [...clientTokens].some((t) => wc.has(t))) hints.push("CLIENTE");
    const wp = tokens(wi.product);
    if (productTokens.size && [...productTokens].some((t) => wp.has(t))) hints.push("PRODUCTO");
    const score = (hints.includes("MISMO_DIA") ? 1 : 0) + (hints.includes("CLIENTE") ? 2 : 0) + (hints.includes("PRODUCTO") ? 3 : 0);
    out.push({ workItem: wi, hints, score });
  }
  return out.sort((a, b) => b.score - a.score || a.workItem.plannedDate.localeCompare(b.workItem.plannedDate) || a.workItem.product.localeCompare(b.workItem.product));
}

export const MIN_LINK_REASON = 8;

// ---------- DTOs (servidor → cliente) ----------
export interface LinkEventDto {
  action: "LINK" | "UNLINK";
  taskKey: string;
  workItemId: string;
  summary: string;
  workItemSummary: string;
  reason: string | null;
  actorEmail: string;
  actorName: string;
  at: string;
}

export interface LinkView {
  linkId: string;
  version: number;
  workItemId: string;
  workItem: WorkItemBrief | null;
  linkedByName: string;
  linkedBy: string;
  createdAt: string;
  /** Texto de la tarea cuando se vinculó. */
  summary: string;
  taskDate: string | null;
  /** Se asoció a la tarea actual por texto corregido o traslado de día. */
  relinked?: boolean;
  /** Avisos que Producción debería revisar (no bloquean la lectura). */
  warnings: string[];
}

export interface TaskLinksPayload {
  /** false = sin base / migración 0042 pendiente: no se puede vincular. */
  available: boolean;
  byTask: Record<string, LinkView[]>;
  /** Vínculos cuya tarea ya no está en la planilla (hay que corregirlos). */
  orphans: LinkView[];
}

export interface WorkItemPriorityDto {
  priority: Priority;
  priorityInfo: StoredPriority | null;
  /** Tarea de Semanas vinculada (lo que se ve en la planilla). */
  taskKey: string;
  taskProducts: string[];
  taskClient: string | null;
  taskDate: string | null;
  /** Último día de la tarea (tareas de varios días). */
  taskEndDate: string | null;
  taskQuantities: string[];
  /** Responsable / línea de la tarea en la planilla (si la banda lo indica). */
  taskAssignee: string | null;
  /** Pestaña de la tarea (para cambiar su prioridad con la misma API que Semanas). */
  tabKey: "ELABORACION" | "ACONDICIONAMIENTO";
}

/** Una diferencia entre el trabajo («Mi trabajo», base) y su tarea vinculada (Semanas, Google Sheets). */
export interface PlanDivergence {
  field: "plannedDate" | "plannedQuantity";
  label: string;
  /** Lo que dice Semanas. */
  semanas: string;
}

const numbersIn = (v: string) => (v.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(/\./g, "").replace(",", ".")));

/**
 * Diferencias INFORMATIVAS entre un trabajo vinculado y su tarea de Semanas. Los dos datos viven en sistemas distintos
 * (base vs planilla) y NO se sincronizan solos: esto solo avisa a Producción para que decida dónde corregir.
 *  - Fecha: el trabajo está fuera del rango de días de la tarea.
 *  - Cantidad: la cantidad planificada del trabajo no aparece como número en ninguna línea de la tarea
 *    (la planilla mezcla producto y cantidad: «CREMA CHICLE 95kg», «1000 x200ml»).
 * El producto no se compara (nombres escritos a mano distinto en cada sistema darían falsas alarmas).
 */
export function planDivergences(wi: { plannedDate: string | null; plannedQuantity: string | null }, task: Pick<WorkItemPriorityDto, "taskDate" | "taskEndDate" | "taskProducts" | "taskQuantities">, fmtDay: (iso: string | null) => string): PlanDivergence[] {
  const out: PlanDivergence[] = [];
  if (wi.plannedDate && task.taskDate) {
    const end = task.taskEndDate ?? task.taskDate;
    if (wi.plannedDate < task.taskDate || wi.plannedDate > end) {
      out.push({ field: "plannedDate", label: "Fecha", semanas: end !== task.taskDate ? `${fmtDay(task.taskDate)} → ${fmtDay(end)}` : fmtDay(task.taskDate) });
    }
  }
  const qty = numbersIn(wi.plannedQuantity ?? "")[0];
  if (qty !== undefined && Number.isFinite(qty)) {
    const lines = [...task.taskProducts, ...task.taskQuantities];
    const nums = lines.flatMap(numbersIn);
    if (!nums.some((n) => Math.abs(n - qty) < 1e-9)) out.push({ field: "plannedQuantity", label: "Cantidad", semanas: lines.join(" · ") || "sin cantidad en la planilla" });
  }
  return out;
}

export interface WorkItemPrioritiesPayload {
  available: boolean;
  /** Por id de cliente (`native:<uuid>`). Un trabajo sin vínculo (o con la tarea borrada) no aparece. */
  byWorkItem: Record<string, WorkItemPriorityDto>;
}
