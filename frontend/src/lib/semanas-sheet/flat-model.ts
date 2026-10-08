/**
 * Modelo de las pestañas planas de SEMANAS 2026: ENTREGAS (FECHA, CLIENTE,
 * PRODUCTO, CANTIDAD) y QACONDDIA = "C/DIA" (registro diario con la fecha solo en
 * la primera fila de cada día). PURO — describe celdas y su protección; no escribe.
 */
import { parseFlexibleDate } from "@/features/os/operational/lib/delivery-date";
import { a1Of, columnLetter, parseA1, type SheetMerge } from "./calendar-model";

export type FlatKind = "ENTREGAS" | "CDIA";

export interface FlatColumn {
  index: number;
  letter: string;
  title: string;
}

export interface FlatCell {
  a1: string;
  value: string;
  protection: string | null;
}

export interface FlatRow {
  rowNumber: number;
  role: "structural" | "data";
  /** ISO de la fecha efectiva de la fila (hereda la del día en C/DIA). */
  date: string | null;
  cells: FlatCell[];
}

export interface FlatTable {
  kind: FlatKind;
  columns: FlatColumn[];
  rows: FlatRow[];
}

const fold = (v: string) => v.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Bloqueo por proceso operativo REAL de una fila (entrega confirmada/remito en GENUS,
 * producción cerrada...). Devuelve el motivo o null. NO existe ventana de antigüedad:
 * un registro histórico se puede corregir mientras no esté cerrado (con motivo + auditoría).
 */
export type FlatRowLock = (info: { kind: FlatKind; date: string | null; values: string[]; columns: FlatColumn[] }) => string | null;

export function parseFlatTable(
  kind: FlatKind,
  rows: string[][],
  merges: SheetMerge[],
  options: { formulaCells?: ReadonlySet<string>; rowLock?: FlatRowLock }
): FlatTable {
  const headerIdx = rows.findIndex((r) => fold(r[1] ?? "") === "fecha");
  if (headerIdx < 0) return { kind, columns: [], rows: [] };
  const header = rows[headerIdx]!;
  const columns: FlatColumn[] = [];
  for (let c = 1; c < header.length; c += 1) {
    const title = String(header[c] ?? "").trim();
    if (!title) {
      if (columns.length > 0) break;
      continue;
    }
    columns.push({ index: c, letter: columnLetter(c), title });
  }
  const out: FlatRow[] = [];
  let currentDate: string | null = null;
  const covered = (row: number, col: number) =>
    merges.some((m) => row >= m.startRow && row <= m.endRow && col + 1 >= m.startColumn && col + 1 <= m.endColumn && !(row === m.startRow && col + 1 === m.startColumn));

  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const rowNumber = i + 1;
    const texts = columns.map((c) => String(row[c.index] ?? "").trim());
    if (texts.every((t) => !t)) continue; // renglón vacío: no se lista (no se crean filas desde la grilla)
    const first = texts[0] ?? "";
    // Encabezados repetidos / títulos de mes ("FEBRERO 2026") → estructurales.
    const isRepeatedHeader = fold(first) === "fecha";
    const isMonthTitle = texts.filter(Boolean).length === 1 && /^[a-zñáéíóú]+\s+\d{4}$/i.test(first);
    const iso = first ? parseFlexibleDate(first) : null;
    if (iso) currentDate = iso;
    const structural = isRepeatedHeader || isMonthTitle;

    const date = structural ? null : currentDate;
    const rowLockReason = structural ? null : (options.rowLock?.({ kind, date, values: columns.map((c) => String(row[c.index] ?? "")), columns }) ?? null);
    const cells: FlatCell[] = columns.map((col) => {
      const a1 = a1Of(rowNumber, col.index);
      let protection: string | null = null;
      if (structural) protection = "Encabezado/título: solo lectura.";
      else if (covered(rowNumber, col.index)) protection = "Celda combinada: se edita en la celda ancla.";
      else if (options.formulaCells?.has(a1)) protection = "Celda con fórmula: no se sobrescribe.";
      else if (rowLockReason) protection = rowLockReason;
      return { a1, value: String(row[col.index] ?? ""), protection };
    });
    out.push({ rowNumber, role: structural ? "structural" : "data", date, cells });
  }
  return { kind, columns, rows: out };
}

export function findFlatCell(table: FlatTable, a1: string): FlatCell | null {
  const pos = parseA1(a1);
  if (!pos) return null;
  return table.rows.find((r) => r.rowNumber === pos.row)?.cells.find((c) => c.a1 === a1.toUpperCase()) ?? null;
}
