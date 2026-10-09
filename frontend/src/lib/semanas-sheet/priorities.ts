/**
 * Prioridad operativa de una tarea de Semanas — tipos y reglas PURAS (cliente y servidor).
 * Prioridad ≠ estado de producción: no existe un "estado" en la planilla, y acá no se inventa ninguno.
 */
export const PRIORITIES = ["URGENTE", "IMPORTANTE", "NORMAL"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const DEFAULT_PRIORITY: Priority = "NORMAL";

export const PRIORITY_META: Record<Priority, { label: string; icon: string; rank: number; description: string }> = {
  URGENTE: { label: "URGENTE", icon: "🔴", rank: 0, description: "Requiere atención inmediata" },
  IMPORTANTE: { label: "IMPORTANTE", icon: "🟡", rank: 1, description: "Priorizar frente a tareas normales" },
  NORMAL: { label: "NORMAL", icon: "🟢", rank: 2, description: "Producción programada habitual" },
};

export function isPriority(v: unknown): v is Priority {
  return typeof v === "string" && (PRIORITIES as readonly string[]).includes(v);
}

export interface StoredPriority {
  priority: Priority;
  version: number;
  updatedBy: string;
  updatedByName: string;
  updatedAt: string;
  /** Se asoció por posición o por traslado de día (la clave guardada ya no coincide con la tarea actual). */
  relinked?: boolean;
  /** La tarea se movió de día (contenido idéntico, inequívoco) y la prioridad la acompañó. */
  moved?: boolean;
}

export interface PriorityRow {
  taskKey: string;
  posKey: string;
  priority: Priority;
  version: number;
  updatedBy: string;
  updatedByName: string;
  updatedAt: string;
}

/** Cómo se asoció una prioridad guardada con la tarea actual. */
export type PriorityMatchKind = "exact" | "pos" | "moved";

/** Partes de una clave de tarea `pestaña|fecha|línea|línea…|n`. null si la clave no tiene ese formato. */
export function parseTaskKey(key: string): { tab: string; date: string; lines: string[] } | null {
  const parts = key.split("|");
  if (parts.length < 4 || !/^\d+$/.test(parts[parts.length - 1]!)) return null;
  return { tab: parts[0]!, date: parts[1]!, lines: parts.slice(2, -1) };
}
/** Semana (lunes ISO) de una `posKey` `pestaña|lunes|d|sN|orden`. */
function weekOfPos(posKey: string): string | null {
  return posKey.split("|")[1] ?? null;
}

/**
 * Marca guardada junto a la posición cuando, al fijar la prioridad, el contenido de la tarea era ÚNICO en su semana.
 * Solo así un traslado de día es inequívoco: si había otra tarea idéntica esa semana, nunca se infiere un traslado.
 */
const SOLO = "|solo";
export function posBase(posKey: string): string {
  return posKey.endsWith(SOLO) ? posKey.slice(0, -SOLO.length) : posKey;
}
function contentOf(key: string): string | null {
  const p = parseTaskKey(key);
  return p ? `${p.tab}|${p.lines.join("|")}` : null;
}
/** `posKey` a guardar para `task`: con la marca de unicidad si su contenido no se repite en la semana. */
export function storedPosKey(task: { key: string; posKey: string }, tasks: Array<{ key: string; posKey: string }>): string {
  const c = contentOf(task.key);
  const w = weekOfPos(task.posKey);
  if (!c) return task.posKey;
  const same = tasks.filter((t) => weekOfPos(t.posKey) === w && contentOf(t.key) === c).length;
  return same === 1 ? `${task.posKey}${SOLO}` : task.posKey;
}

/**
 * ¿Es la MISMA tarea con el texto corregido? Se exige al menos una línea en común y como mucho UNA línea distinta
 * (agregada, quitada o corregida). Si cambió todo, no se puede afirmar que sea la misma tarea: no se transfiere.
 */
export function isTextCorrection(oldKey: string, newKey: string): boolean {
  const a = parseTaskKey(oldKey);
  const b = parseTaskKey(newKey);
  if (!a || !b) return false;
  const pool = [...a.lines];
  let common = 0;
  for (const l of b.lines) {
    const i = pool.indexOf(l);
    if (i >= 0) { common += 1; pool.splice(i, 1); }
  }
  return common >= 1 && Math.max(a.lines.length, b.lines.length) - common <= 1;
}

/**
 * Asocia las prioridades guardadas con las tareas ACTUALES de la planilla. Nunca asigna una fila a dos tareas ni pisa
 * la fila propia de una tarea; ante cualquier ambigüedad la tarea queda en NORMAL (es preferible a heredar una prioridad ajena).
 *  1) `exact`: misma clave (contenido + fecha). Sobrevive a insertar/borrar filas, reordenar y renombrar al responsable.
 *  2) `pos`: misma posición (semana/día/sección/orden) Y el texto es una corrección de la tarea guardada (≥1 línea en
 *     común, ≤1 distinta). Si se ELIMINÓ una tarea y otra ocupó su lugar, el contenido no coincide y no se transfiere.
 *  3) `moved`: la tarea se movió de DÍA dentro de la misma semana, con contenido idéntico, y es inequívoca: al guardar
 *     la prioridad ese contenido era único en la semana (marca `|solo`), y hoy hay una sola fila huérfana y una sola
 *     tarea sin prioridad con ese contenido en esa semana.
 */
export function matchPriorityRows<R extends PriorityRow>(tasks: Array<{ key: string; posKey: string }>, rows: R[]): Map<string, { row: R; how: PriorityMatchKind }> {
  const out = new Map<string, { row: R; how: PriorityMatchKind }>();
  const byKey = new Map(rows.map((r) => [r.taskKey, r] as const));
  const currentKeys = new Set(tasks.map((t) => t.key));
  const orphans = new Set(rows.filter((r) => !currentKeys.has(r.taskKey)));
  for (const t of tasks) {
    const exact = byKey.get(t.key);
    if (exact) out.set(t.key, { row: exact, how: "exact" });
  }
  for (const t of tasks) {
    if (out.has(t.key)) continue;
    const orphan = [...orphans].find((r) => r.posKey && posBase(r.posKey) === t.posKey && isTextCorrection(r.taskKey, t.key));
    if (orphan) {
      out.set(t.key, { row: orphan, how: "pos" });
      orphans.delete(orphan);
    }
  }
  const groupKey = (key: string, posKey: string) => {
    const c = contentOf(key);
    const w = weekOfPos(posKey);
    return c && w ? `${w}#${c}` : null;
  };
  const orphanGroups = new Map<string, R[]>();
  for (const r of orphans) {
    if (!r.posKey.endsWith(SOLO)) continue; // al guardarla había otra tarea idéntica en la semana: traslado ambiguo
    const g = groupKey(r.taskKey, r.posKey);
    if (g) orphanGroups.set(g, [...(orphanGroups.get(g) ?? []), r]);
  }
  const taskGroups = new Map<string, string[]>();
  for (const t of tasks) {
    if (out.has(t.key)) continue;
    const g = groupKey(t.key, t.posKey);
    if (g) taskGroups.set(g, [...(taskGroups.get(g) ?? []), t.key]);
  }
  for (const [g, rs] of orphanGroups) {
    const ts = taskGroups.get(g);
    if (rs.length === 1 && ts?.length === 1) out.set(ts[0]!, { row: rs[0]!, how: "moved" });
  }
  return out;
}

export function matchPriorities(tasks: Array<{ key: string; posKey: string }>, rows: PriorityRow[]): Record<string, StoredPriority> {
  const out: Record<string, StoredPriority> = {};
  for (const [key, { row: r, how }] of matchPriorityRows(tasks, rows)) {
    out[key] = { priority: r.priority, version: r.version, updatedBy: r.updatedBy, updatedByName: r.updatedByName, updatedAt: r.updatedAt, ...(how !== "exact" ? { relinked: true } : {}), ...(how === "moved" ? { moved: true } : {}) };
  }
  return out;
}

export function priorityOf(map: Record<string, StoredPriority> | undefined, key: string): Priority {
  return map?.[key]?.priority ?? DEFAULT_PRIORITY;
}

export interface PrioritiesPayload {
  /** Prioridades por clave de tarea ACTUAL (ausente = NORMAL). */
  byTask: Record<string, StoredPriority>;
  /** false = la tabla todavía no existe (migración 0041 pendiente): se muestra NORMAL y no se puede guardar. */
  available: boolean;
}
