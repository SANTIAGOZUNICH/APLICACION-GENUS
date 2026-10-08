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
  /** Se asoció por posición (el texto de la tarea cambió desde que se guardó). */
  relinked?: boolean;
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

/**
 * Asocia las prioridades guardadas con las tareas ACTUALES de la planilla.
 *  1) coincidencia exacta por `key` (contenido + fecha): sobrevive a insertar/borrar filas y a reordenar;
 *  2) si no hay, por `posKey` (semana/día/sección/orden) SOLO con filas guardadas que ya no coinciden con
 *     ninguna tarea actual (el texto se corrigió sin mover la tarea).
 */
export function matchPriorities(tasks: Array<{ key: string; posKey: string }>, rows: PriorityRow[]): Record<string, StoredPriority> {
  const out: Record<string, StoredPriority> = {};
  const byKey = new Map(rows.map((r) => [r.taskKey, r] as const));
  const currentKeys = new Set(tasks.map((t) => t.key));
  const orphansByPos = new Map<string, PriorityRow>();
  for (const r of rows) if (!currentKeys.has(r.taskKey) && r.posKey) orphansByPos.set(r.posKey, r);
  const toStored = (r: PriorityRow, relinked: boolean): StoredPriority => ({
    priority: r.priority, version: r.version, updatedBy: r.updatedBy, updatedByName: r.updatedByName, updatedAt: r.updatedAt, ...(relinked ? { relinked: true } : {}),
  });
  for (const t of tasks) {
    const exact = byKey.get(t.key);
    if (exact) {
      out[t.key] = toStored(exact, false);
      continue;
    }
    const orphan = orphansByPos.get(t.posKey);
    if (orphan) {
      out[t.key] = toStored(orphan, true);
      orphansByPos.delete(t.posKey);
    }
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
