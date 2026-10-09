/**
 * Lógica pura de la grilla Excel (sin React) — testeable sin DOM.
 */

export interface GenusGridRow {
  /** id estable del registro (rowKey). */
  __id: string;
  /** versión de concurrencia del registro (p. ej. updatedAt). */
  __version: string;
  /** columna → motivo de protección (null/ausente = editable). */
  __prot: Record<string, string | null>;
  /** columna → estado de guardado optimista. */
  __st: Record<string, "saving" | "error" | undefined>;
  /** columna → nota de trazabilidad (p. ej. «el ingreso original dice X»); se ve al pasar el mouse. */
  __note?: Record<string, string | null>;
  [columnKey: string]: unknown;
}

export interface CellDiff {
  rowId: string;
  columnKey: string;
  oldValue: string;
  newValue: string;
}

const asText = (value: unknown): string => (typeof value === "string" ? value : value == null ? "" : String(value));

/**
 * Compara filas previas vs. nuevas (salida de react-datasheet-grid) y devuelve
 * SOLO las celdas cuyo valor cambió. Es la base del "PATCH por celda": nunca
 * se envía una fila completa, solo la lista de celdas realmente modificadas.
 */
export function diffGridRows(prev: GenusGridRow[], next: GenusGridRow[], columnKeys: string[]): CellDiff[] {
  if (prev.length !== next.length) return [];
  const diffs: CellDiff[] = [];
  for (let i = 0; i < next.length; i += 1) {
    const before = prev[i]!;
    const after = next[i]!;
    if (before === after) continue;
    if (before.__id !== after.__id) continue;
    for (const key of columnKeys) {
      const oldValue = asText(before[key]);
      const newValue = asText(after[key]).trim();
      if (oldValue.trim() !== newValue) {
        diffs.push({ rowId: after.__id, columnKey: key, oldValue, newValue });
      }
    }
  }
  return diffs;
}

/** Fecha/valor tal cual para mostrar en el preview (vacío → "(vacío)"). */
export function previewValue(value: string): string {
  return value.trim() === "" ? "(vacío)" : value;
}
