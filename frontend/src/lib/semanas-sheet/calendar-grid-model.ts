/**
 * Lógica pura de la grilla de calendario con celdas combinadas (selección, copia, pegado, navegación).
 * Coordenadas: (ri, d) = índice de fila dentro de la semana, día 0..4 (Lun..Vie). Cada celda ancla
 * ocupa un rectángulo [ri, ri+rowSpan-1] × [d, d+span-1]; las demás posiciones "pertenecen" a su ancla.
 * Nada acá escribe: solo decide qué celdas se ven/seleccionan/copian y cuáles son editables.
 */
import type { CalendarCell, CalendarWeek } from "./calendar-model";

export interface Pos { ri: number; d: number }
export interface Rect { r0: number; r1: number; d0: number; d1: number }

export interface WeekLayout {
  week: CalendarWeek;
  /** owner[ri][d] = posición del ancla que ocupa esa coordenada. */
  owner: Pos[][];
}

export function buildLayout(week: CalendarWeek): WeekLayout {
  const rows = week.rows;
  const owner: Pos[][] = rows.map((_, ri) => Array.from({ length: 5 }, (_, d) => ({ ri, d })));
  rows.forEach((row, ri) => {
    row.cells.forEach((cell, d) => {
      if (cell.covered) return;
      const r1 = Math.min(rows.length - 1, ri + Math.max(1, cell.rowSpan) - 1);
      const d1 = Math.min(4, d + Math.max(1, cell.span) - 1);
      for (let r = ri; r <= r1; r += 1) for (let c = d; c <= d1; c += 1) owner[r]![c] = { ri, d };
    });
  });
  return { week, owner };
}

export function cellAt(layout: WeekLayout, p: Pos): CalendarCell | undefined {
  const o = layout.owner[p.ri]?.[p.d];
  return o ? layout.week.rows[o.ri]?.cells[o.d] : undefined;
}

export function anchorOf(layout: WeekLayout, p: Pos): Pos {
  return layout.owner[p.ri]?.[p.d] ?? p;
}

export function makeRect(a: Pos, b: Pos): Rect {
  return { r0: Math.min(a.ri, b.ri), r1: Math.max(a.ri, b.ri), d0: Math.min(a.d, b.d), d1: Math.max(a.d, b.d) };
}

/** Expande el rectángulo hasta incluir completas todas las combinaciones que toca (como Sheets). */
export function expandRect(layout: WeekLayout, rect: Rect): Rect {
  let cur = { ...rect };
  for (let guard = 0; guard < 10; guard += 1) {
    let changed = false;
    for (let r = cur.r0; r <= cur.r1; r += 1) {
      for (let d = cur.d0; d <= cur.d1; d += 1) {
        const a = anchorOf(layout, { ri: r, d });
        const c = cellAt(layout, a);
        if (!c) continue;
        const r1 = Math.min(layout.week.rows.length - 1, a.ri + c.rowSpan - 1);
        const d1 = Math.min(4, a.d + c.span - 1);
        const next = { r0: Math.min(cur.r0, a.ri), r1: Math.max(cur.r1, r1), d0: Math.min(cur.d0, a.d), d1: Math.max(cur.d1, d1) };
        if (next.r0 !== cur.r0 || next.r1 !== cur.r1 || next.d0 !== cur.d0 || next.d1 !== cur.d1) { cur = next; changed = true; }
      }
    }
    if (!changed) break;
  }
  return cur;
}

/** ¿La celda ancla `a` intersecta el rectángulo? */
export function anchorInRect(layout: WeekLayout, a: Pos, rect: Rect): boolean {
  const c = cellAt(layout, a);
  if (!c) return false;
  const r1 = a.ri + c.rowSpan - 1;
  const d1 = a.d + c.span - 1;
  return !(a.ri > rect.r1 || r1 < rect.r0 || a.d > rect.d1 || d1 < rect.d0);
}

/** Texto TSV del rango, como Excel/Sheets: el valor de una combinación aparece solo en su esquina. */
export function copyRange(layout: WeekLayout, rect: Rect, overlay?: Record<string, string>): string {
  const lines: string[] = [];
  for (let r = rect.r0; r <= rect.r1; r += 1) {
    const cols: string[] = [];
    for (let d = rect.d0; d <= rect.d1; d += 1) {
      const a = anchorOf(layout, { ri: r, d });
      const cell = cellAt(layout, a);
      // Dentro de una combinación, la esquina visible del rango lleva el valor.
      const isTopLeftInRange = Math.max(a.ri, rect.r0) === r && Math.max(a.d, rect.d0) === d;
      const v = cell && isTopLeftInRange ? (overlay?.[cell.a1] ?? cell.value) : "";
      cols.push(v.replace(/[\t\r\n]+/g, " "));
    }
    lines.push(cols.join("\t"));
  }
  return lines.join("\n");
}

export function parseClipboard(text: string): string[][] {
  const t = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  if (t === "") return [[""]];
  return t.split("\n").map((l) => l.split("\t"));
}

export interface PlannedChange { a1: string; oldValue: string; newValue: string; date: string | null }
export interface SkippedCell { a1: string; reason: string }
export interface InvalidCell { a1: string; message: string }

export const MAX_CELL_CHARS = 300;
export function validateCalendarValue(raw: string): string | null {
  if (raw.trim().startsWith("=")) return "No se permiten fórmulas.";
  if (raw.length > MAX_CELL_CHARS) return `Máximo ${MAX_CELL_CHARS} caracteres.`;
  return null;
}

/**
 * Pegado: la matriz se coloca desde la esquina del rango (o de la celda activa), una posición de
 * la grilla por valor. Combinaciones: se escribe en el ancla; protegidas/estructurales se informan.
 */
export function planPaste(
  layout: WeekLayout,
  start: Pos,
  matrix: string[][],
  canEdit: boolean,
  overlay?: Record<string, string>
): { changes: PlannedChange[]; skipped: SkippedCell[]; invalid: InvalidCell[] } {
  const changes: PlannedChange[] = [];
  const skipped: SkippedCell[] = [];
  const invalid: InvalidCell[] = [];
  const seen = new Set<string>();
  const rows = layout.week.rows;
  matrix.forEach((line, dr) => {
    let d = start.d;
    line.forEach((raw) => {
      const ri = start.ri + dr;
      if (ri >= rows.length || d > 4) { d += 1; return; }
      const a = anchorOf(layout, { ri, d });
      const cell = cellAt(layout, a);
      // Avanza por columnas de la grilla; una combinación de N días consume N columnas del origen.
      const advance = 1;
      d += advance;
      if (!cell || seen.has(cell.a1)) return;
      seen.add(cell.a1);
      const reason = !canEdit ? "Tu sector no puede editar esta planilla." : cell.protection;
      if (reason) { skipped.push({ a1: cell.a1, reason }); return; }
      const current = overlay?.[cell.a1] ?? cell.value;
      const value = raw.trim();
      const problem = validateCalendarValue(value);
      if (problem) { invalid.push({ a1: cell.a1, message: problem }); return; }
      if (value === current.trim()) return;
      changes.push({ a1: cell.a1, oldValue: cell.value, newValue: value, date: cell.date });
    });
  });
  return { changes, skipped, invalid };
}

/** Movimiento con flechas respetando combinaciones: salta al otro lado del bloque actual. */
export function moveFrom(layout: WeekLayout, from: Pos, key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"): Pos {
  const a = anchorOf(layout, from);
  const c = cellAt(layout, a);
  const rows = layout.week.rows.length;
  const rowSpan = c?.rowSpan ?? 1;
  const span = c?.span ?? 1;
  let ri = a.ri;
  let d = a.d;
  if (key === "ArrowDown") ri = Math.min(rows - 1, a.ri + rowSpan);
  if (key === "ArrowUp") ri = Math.max(0, a.ri - 1);
  if (key === "ArrowRight") d = Math.min(4, a.d + span);
  if (key === "ArrowLeft") d = Math.max(0, a.d - 1);
  return anchorOf(layout, { ri, d });
}
