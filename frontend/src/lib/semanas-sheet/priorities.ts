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
  /** La tarea cambió de día: se asoció por contenido idéntico e inequívoco. */
  relinked?: boolean;
  /** Clave con la que está guardada la fila (distinta de la clave actual si `relinked`). Uso interno. */
  rowTaskKey?: string;
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

/** Contenido de la tarea dentro de la clave (sin fecha ni n° de repetición): sirve para detectar que cambió de día. */
export function contentOfKey(key: string): string {
  const parts = key.split("|");
  return `${parts[0]}|${parts.slice(2, -1).join("|")}`;
}

/**
 * Asocia las prioridades guardadas con las tareas ACTUALES de la planilla. Solo de forma INEQUÍVOCA:
 *  1) coincidencia exacta por `key` (pestaña + fecha + contenido + repetición): sobrevive a insertar/borrar filas,
 *     reordenar tareas o renombrar al responsable;
 *  2) «cambió de día»: una fila guardada que ya no coincide con ninguna tarea y UNA sola tarea actual (sin prioridad
 *     propia) con exactamente el mismo contenido en otra fecha → la prioridad la acompaña (`moved`);
 *  Nunca por posición: si una tarea se elimina o se reemplaza por otra distinta, su prioridad NO pasa a la nueva
 *  (queda huérfana en la base, auditada). Las correcciones de texto hechas desde GENUS re-asocian explícitamente la
 *  clave (ver `rekeyEditedTasks`), no por inferencia.
 */
export function matchPriorities(tasks: Array<{ key: string; posKey: string }>, rows: PriorityRow[]): Record<string, StoredPriority> {
  const out: Record<string, StoredPriority> = {};
  const byKey = new Map(rows.map((r) => [r.taskKey, r] as const));
  const currentKeys = new Set(tasks.map((t) => t.key));
  const toStored = (r: PriorityRow, moved: boolean): StoredPriority => ({
    priority: r.priority, version: r.version, updatedBy: r.updatedBy, updatedByName: r.updatedByName, updatedAt: r.updatedAt, rowTaskKey: r.taskKey, ...(moved ? { relinked: true } : {}),
  });
  const unmatched: Array<{ key: string }> = [];
  for (const t of tasks) {
    const exact = byKey.get(t.key);
    if (exact) out[t.key] = toStored(exact, false);
    else unmatched.push(t);
  }
  const orphans = rows.filter((r) => !currentKeys.has(r.taskKey));
  const orphanByContent = new Map<string, PriorityRow[]>();
  for (const r of orphans) orphanByContent.set(contentOfKey(r.taskKey), [...(orphanByContent.get(contentOfKey(r.taskKey)) ?? []), r]);
  const taskByContent = new Map<string, Array<{ key: string }>>();
  for (const t of unmatched) taskByContent.set(contentOfKey(t.key), [...(taskByContent.get(contentOfKey(t.key)) ?? []), t]);
  for (const [content, ts] of taskByContent) {
    const os = orphanByContent.get(content) ?? [];
    if (ts.length === 1 && os.length === 1) out[ts[0]!.key] = toStored(os[0]!, true);
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
