/**
 * Tareas de SEMANAS 2026 proyectadas por SECTOR (módulo PURO, cliente y servidor).
 *
 * Una única proyección para TODAS las pantallas (Producción → Semanas, Semanas / Día a día de cada sector y Modo TV):
 * misma tarea → mismo producto, cantidad, fecha, responsable, sector y prioridad. No hay una segunda interpretación de
 * la planilla: se parte del modelo de tareas de `calendar-tasks.ts` y de las prioridades de la tabla 0041.
 *
 * Qué sector "es dueño" de una tarea sale de la pestaña y de la banda (celda combinada) que la contiene:
 *  - ELABORACION → Elaboración; la banda es el RESPONSABLE (CRISTIAN, NICOLAS…).
 *  - ACONDICIONAMIENTO → la banda «ENVASADO CONSUMO MASIVO» es Envasado Masivo y «… PREMIUM/PREMIUN» es Envasado Premium.
 *    Si la planilla agrega bandas de LÍNEA (LÍNEA 1, PREMIUM A…) heredan el sector de la banda anterior y se muestran
 *    como LÍNEA. Una banda que no se puede clasificar NO se asigna a ningún sector (solo la ve Producción).
 * Nada se infiere de colores ni se inventa: un campo que la planilla no tiene no se muestra.
 */
import type { CalendarWeek } from "./calendar-model";
import { buildWeekModel, type CalendarTask, type LineRole, type WeekModel } from "./calendar-tasks";
import { DEFAULT_PRIORITY, PRIORITY_META, type PrioritiesPayload, type Priority, type StoredPriority } from "./priorities";
import type { SemanasTabKey } from "./semanas-tabs";

/** Sectores de planta que tienen planificación en SEMANAS 2026. */
export const PLAN_SECTORS = ["ELABORACION", "ENVASADO_MASIVO", "ENVASADO_PREMIUM"] as const;
export type PlanSector = (typeof PLAN_SECTORS)[number];
export const PLAN_SECTOR_LABEL: Record<PlanSector, string> = {
  ELABORACION: "Elaboración",
  ENVASADO_MASIVO: "Envasado Masivo",
  ENVASADO_PREMIUM: "Envasado Premium",
};
export const PLAN_SECTOR_TAB: Record<PlanSector, Extract<SemanasTabKey, "ELABORACION" | "ACONDICIONAMIENTO">> = {
  ELABORACION: "ELABORACION",
  ENVASADO_MASIVO: "ACONDICIONAMIENTO",
  ENVASADO_PREMIUM: "ACONDICIONAMIENTO",
};
export function isPlanSector(v: unknown): v is PlanSector {
  return typeof v === "string" && (PLAN_SECTORS as readonly string[]).includes(v);
}

/**
 * Qué planificación puede VER cada sector de sesión (solo lectura). Producción y Dirección ven todo.
 * Codificado y Depósito ven Envasado (Masivo y Premium) y Materia Prima ve Elaboración: la misma regla que ya rige
 * el plan semanal compartido (`weekly-plans-rbac.ts`). Calidad y Comercial no tienen planificación en Semanas.
 */
const VIEW_SCOPE: Record<string, readonly PlanSector[]> = {
  PRODUCCION: PLAN_SECTORS,
  DIRECCION: PLAN_SECTORS,
  ELABORACION: ["ELABORACION"],
  ENVASADO_MASIVO: ["ENVASADO_MASIVO"],
  ENVASADO_PREMIUM: ["ENVASADO_PREMIUM"],
  CODIFICADO: ["ENVASADO_MASIVO", "ENVASADO_PREMIUM"],
  DEPOSITO: ["ENVASADO_MASIVO", "ENVASADO_PREMIUM"],
  MATERIA_PRIMA: ["ELABORACION"],
};
export function viewablePlanSectors(viewer: string | null | undefined): PlanSector[] {
  return [...(VIEW_SCOPE[viewer ?? ""] ?? [])];
}
/** Producción y Dirección ven también las tareas que no se pueden asignar a un sector. */
export function seesWholePlan(viewer: string | null | undefined): boolean {
  return viewer === "PRODUCCION" || viewer === "DIRECCION";
}

const fold = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
/** Saca emojis y separadores decorativos de una banda («🍶  ENVASADO CONSUMO MASIVO  |  3 LÍNEAS» → texto). */
export function cleanBandTitle(v: string): string {
  return v.replace(/[\p{Extended_Pictographic}️]/gu, "").replace(/\s+/g, " ").trim();
}
const LINE_RE = /^(l[ií]nea\s*\d+|premium\s+[a-z0-9])\b/i;

export interface PlanAssignee {
  kind: "RESPONSABLE" | "LÍNEA";
  value: string;
}

export interface PlanTaskLine {
  role: LineRole;
  value: string;
  /** Celda de la Sheet (solo se envía a Producción, que es quien edita). */
  a1?: string;
  protection?: string | null;
  ri?: number;
  d?: number;
}

export interface PlanTask {
  key: string;
  /** Posición semana/día/sección/orden (respaldo para re-asociar prioridad y vínculos cuando se corrige el texto). */
  posKey: string;
  tabKey: "ELABORACION" | "ACONDICIONAMIENTO";
  weekId: string;
  /** Lunes ISO de la semana (identifica la semana entre pestañas; si no hay fecha, el id del bloque). */
  weekStart: string;
  /** Día de inicio (0 = lunes) y días que abarca (celda combinada de varios días). */
  d: number;
  span: number;
  date: string | null;
  /** Fecha ISO del último día (tareas de varios días). */
  endDate: string | null;
  sector: PlanSector | null;
  /** Banda de la planilla tal cual (sin emojis). */
  section: string | null;
  assignee: PlanAssignee | null;
  client: string | null;
  products: string[];
  quantities: string[];
  notes: string[];
  lines: PlanTaskLine[];
  priority: Priority;
  /** Quién y cuándo fijó la prioridad (null = NORMAL inicial). */
  priorityInfo: StoredPriority | null;
}

/** Sector y responsable/línea de cada sección de la semana, en orden (las líneas heredan el sector de la banda previa). */
export function classifySections(tabKey: PlanTask["tabKey"], model: WeekModel): Map<number, { sector: PlanSector | null; section: string | null; assignee: PlanAssignee | null }> {
  const out = new Map<number, { sector: PlanSector | null; section: string | null; assignee: PlanAssignee | null }>();
  let band: PlanSector | null = null;
  for (const s of model.sections) {
    const title = s.title ? cleanBandTitle(s.title.value) : null;
    if (tabKey === "ELABORACION") {
      out.set(s.index, { sector: "ELABORACION", section: title, assignee: title ? { kind: "RESPONSABLE", value: title } : null });
      continue;
    }
    const f = fold(title ?? "");
    const isLine = title ? LINE_RE.test(title) : false;
    const own: PlanSector | null = /premi/.test(f) ? "ENVASADO_PREMIUM" : /masivo|consumo/.test(f) ? "ENVASADO_MASIVO" : null;
    if (own && !isLine) band = own;
    const sector = own ?? (isLine ? band : null);
    out.set(s.index, { sector, section: title, assignee: isLine && title ? { kind: "LÍNEA", value: title } : null });
  }
  return out;
}

function addDays(iso: string, n: number): string {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export function toPlanTask(
  tabKey: PlanTask["tabKey"],
  task: CalendarTask,
  meta: { sector: PlanSector | null; section: string | null; assignee: PlanAssignee | null },
  priorities: PrioritiesPayload | undefined,
  withCells: boolean
): PlanTask {
  const stored = priorities?.byTask[task.key] ?? null;
  const pick = (role: LineRole) => task.lines.filter((l) => l.role === role).map((l) => l.value);
  return {
    key: task.key,
    posKey: task.posKey,
    tabKey,
    weekId: task.weekId,
    weekStart: task.weekId,
    d: task.d,
    span: task.span,
    date: task.date,
    endDate: task.date && task.span > 1 ? addDays(task.date, Math.min(task.span, 5 - task.d) - 1) : task.date,
    sector: meta.sector,
    section: meta.section,
    assignee: meta.assignee,
    client: pick("client")[0] ?? null,
    products: pick("product"),
    quantities: pick("quantity"),
    notes: pick("note"),
    lines: task.lines.map((l) => (withCells ? { role: l.role, value: l.value, a1: l.a1, protection: l.protection, ri: l.ri, d: l.d } : { role: l.role, value: l.value })),
    priority: stored?.priority ?? DEFAULT_PRIORITY,
    priorityInfo: stored,
  };
}

/** Todas las tareas de una pestaña, proyectadas (en orden de la planilla: semana, día, sección, fila). */
export function projectPlanTasks(
  tabKey: PlanTask["tabKey"],
  weeks: CalendarWeek[],
  tab: string,
  priorities: PrioritiesPayload | undefined,
  opts: { withCells?: boolean } = {}
): PlanTask[] {
  const out: PlanTask[] = [];
  for (const w of weeks) {
    const model = buildWeekModel(w, tab);
    const meta = classifySections(tabKey, model);
    for (const s of model.sections) for (const t of s.tasks) out.push({ ...toPlanTask(tabKey, t, meta.get(s.index)!, priorities, Boolean(opts.withCells)), weekStart: weekStartOf(w) });
  }
  return out;
}

/** Filtra por los sectores que el usuario puede ver (y, para Producción, también las no asignadas). */
export function filterBySectors(tasks: PlanTask[], sectors: readonly PlanSector[], includeUnassigned: boolean): PlanTask[] {
  return tasks.filter((t) => (t.sector ? sectors.includes(t.sector) : includeUnassigned));
}

export function weekStartOf(w: Pick<CalendarWeek, "id" | "dates">): string {
  return w.dates[0] ?? w.id;
}

/** ¿La tarea ocurre ese día? (incluye las de varios días que lo abarcan). */
export function coversDay(t: Pick<PlanTask, "weekStart" | "d" | "span">, weekStart: string, d: number): boolean {
  return t.weekStart === weekStart && (t.d === d || (t.d < d && t.d + t.span - 1 >= d));
}

/** Orden operativo de un día: prioridad (URGENTE primero) y después el orden de la planilla. */
export function byPriority<T extends Pick<PlanTask, "priority">>(list: T[]): T[] {
  return list.map((t, i) => ({ t, i })).sort((a, b) => PRIORITY_META[a.t.priority].rank - PRIORITY_META[b.t.priority].rank || a.i - b.i).map((x) => x.t);
}

export interface PlanDay {
  date: string;
  weekStart: string;
  d: number;
}
/** Días (con fecha) que tienen al menos una tarea, en orden y sin repetir (las pestañas comparten semanas). */
export function plannedDays(weeks: Array<Pick<CalendarWeek, "id" | "dates">>, tasks: PlanTask[]): PlanDay[] {
  const out = new Map<string, PlanDay>();
  for (const w of weeks) {
    const ws = weekStartOf(w);
    w.dates.forEach((date, d) => {
      if (date && !out.has(date) && tasks.some((t) => coversDay(t, ws, d))) out.set(date, { date, weekStart: ws, d });
    });
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** `count` días con planificación desde hoy (o el más cercano, informando el motivo). Nunca inventa días. */
export function pickDays(planned: PlanDay[], today: string, count: number): { days: PlanDay[]; reason: string | null } {
  if (planned.length === 0) return { days: [], reason: null };
  let idx = planned.findIndex((p) => p.date >= today);
  let reason: string | null = null;
  if (idx < 0) {
    idx = Math.max(0, planned.length - count);
    reason = `No hay planificación posterior a hoy (${formatDay(today)}); se muestran los últimos días cargados.`;
  } else if (planned[idx]!.date !== today) {
    reason = `Hoy (${formatDay(today)}) no tiene tareas planificadas; se muestra el próximo día con planificación.`;
  }
  return { days: planned.slice(idx, idx + count), reason };
}

const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** «Mar 26 may» (o «—» si no hay fecha). */
export function formatDay(iso: string | null, opts: { long?: boolean } = {}): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  const dow = (new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7;
  const name = DAY_NAMES[dow]!;
  return `${opts.long ? name : name.slice(0, 3)} ${d} ${MONTHS[m! - 1]}`;
}
