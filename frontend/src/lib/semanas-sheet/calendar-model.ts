/**
 * Modelo fiel de las pestañas ELABORACION / ACONDICIONAMIENTO de SEMANAS 2026.
 *
 * Estructura REAL (verificada sobre la copia local del libro, ver docss/40):
 * bloques de semana apilados; cada bloque empieza en una fila con
 * `Lunes | Martes | Miércoles | Jueves | Viernes` en B, D, F, H, J (cada día =
 * 2 columnas combinadas, p.ej. B:C); la fila siguiente trae el n° de día y la
 * siguiente el mes; debajo van los renglones de planificación (responsable en
 * una banda combinada B:K, luego cliente / producto / cantidad por día).
 *
 * Este módulo es PURO: no escribe nada, solo describe qué celda es qué. La
 * referencia de escritura es SIEMPRE la celda ancla (A1) de la Sheet — nunca se
 * reconstruye el calendario ni se infiere un registro: los renglones son
 * celdas, no work-items.
 */

export interface SheetMerge {
  /** 1-based, inclusivo (misma convención que SheetsReader.getSpreadsheetMeta). */
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

export type CalendarRowRole = "structural" | "planning";

export interface CalendarCell {
  /** Celda ancla (A1) donde vive el valor, p.ej. "F6". */
  a1: string;
  value: string;
  /** Cubierta por una combinación anclada en otra columna: no tiene valor propio. */
  covered: boolean;
  /** Cuántos días abarca la combinación (1 = normal, 5 = banda de toda la semana). */
  span: number;
  /** Protegida por política (estructural, fórmula, día pasado, cubierta) → motivo. */
  protection: string | null;
}

export interface CalendarRow {
  rowNumber: number;
  role: CalendarRowRole;
  cells: CalendarCell[];
}

export interface CalendarWeek {
  id: string;
  headerRow: number;
  lastRow: number;
  /** ISO por día (Lun..Vie) o null si el encabezado no es interpretable. */
  dates: (string | null)[];
  label: string;
  rows: CalendarRow[];
}

export const DAY_NAMES = ["lunes", "martes", "miercoles", "jueves", "viernes"] as const;
/** Columnas ancla (0-based) de cada día: B, D, F, H, J. */
export const DAY_ANCHOR_COLS = [1, 3, 5, 7, 9] as const;

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

export function columnLetter(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

export function a1Of(rowNumber: number, colIndex: number): string {
  return `${columnLetter(colIndex)}${rowNumber}`;
}

export function parseA1(a1: string): { row: number; col: number } | null {
  const m = a1.trim().match(/^([A-Za-z]+)(\d+)$/);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]!.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]), col: col - 1 };
}

const fold = (v: string) =>
  v.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function isWeekHeader(row: string[] | undefined): boolean {
  if (!row) return false;
  return DAY_ANCHOR_COLS.every((c, i) => fold(row[c] ?? "") === DAY_NAMES[i]);
}

function dateFor(dayCell: string | undefined, monthCell: string | undefined, year: number): string | null {
  const day = Number.parseInt(String(dayCell ?? "").replace(",", "."), 10);
  const month = MONTHS[fold(monthCell ?? "")];
  if (!Number.isFinite(day) || !month || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function mergeCovering(merges: SheetMerge[], row: number, col: number): SheetMerge | null {
  return merges.find((m) => row >= m.startRow && row <= m.endRow && col + 1 >= m.startColumn && col + 1 <= m.endColumn) ?? null;
}

export interface ParseCalendarOptions {
  year: number;
  /** Celdas con fórmula (A1) — nunca editables. */
  formulaCells?: ReadonlySet<string>;
  /** ISO de hoy: los días anteriores al lunes de la semana en curso quedan protegidos. */
  today?: string;
}

function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function parseWeeklyCalendar(rows: string[][], merges: SheetMerge[], options: ParseCalendarOptions): CalendarWeek[] {
  const headers: number[] = [];
  rows.forEach((row, i) => {
    if (isWeekHeader(row)) headers.push(i + 1);
  });
  const currentMonday = options.today ? mondayOf(options.today) : null;
  const weeks: CalendarWeek[] = [];

  headers.forEach((headerRow, w) => {
    const nextHeader = headers[w + 1];
    let lastRow = nextHeader ? nextHeader - 1 : rows.length;
    // El último bloque: recortar filas vacías finales.
    while (lastRow > headerRow + 2 && (rows[lastRow - 1] ?? []).every((c) => !String(c ?? "").trim())) lastRow -= 1;
    const dayRow = rows[headerRow] ?? [];
    const monthRow = rows[headerRow + 1] ?? [];
    const dates = DAY_ANCHOR_COLS.map((c) => dateFor(dayRow[c], monthRow[c], options.year));
    const first = dates.find((d) => d) ?? null;
    const last = [...dates].reverse().find((d) => d) ?? null;
    const label = first && last ? `${first.slice(8)}/${first.slice(5, 7)} – ${last.slice(8)}/${last.slice(5, 7)}/${last.slice(0, 4)}` : `Semana (fila ${headerRow})`;

    const outRows: CalendarRow[] = [];
    for (let r = headerRow; r <= lastRow; r += 1) {
      const role: CalendarRowRole = r <= headerRow + 2 ? "structural" : "planning";
      const cells: CalendarCell[] = DAY_ANCHOR_COLS.map((col, d) => {
        const a1 = a1Of(r, col);
        const merge = mergeCovering(merges, r, col);
        const anchorCol = merge ? merge.startColumn - 1 : col;
        const anchorRow = merge ? merge.startRow : r;
        const isAnchor = !merge || (anchorRow === r && anchorCol === col);
        const covered = Boolean(merge) && !isAnchor;
        const spanDays = merge ? Math.max(1, Math.round((merge.endColumn - merge.startColumn + 1) / 2)) : 1;
        const value = covered ? "" : String(rows[r - 1]?.[col] ?? "");
        let protection: string | null = null;
        if (role === "structural") protection = "Encabezado del calendario (día, fecha, mes): solo lectura.";
        else if (covered) protection = "Celda combinada: se edita en la celda ancla.";
        else if (options.formulaCells?.has(a1)) protection = "Celda con fórmula: no se sobrescribe.";
        else if (currentMonday && dates[d] && dates[d]! < currentMonday) protection = "Semana pasada: solo lectura.";
        return { a1, value, covered, span: spanDays, protection };
      });
      outRows.push({ rowNumber: r, role, cells });
    }
    weeks.push({ id: `${headerRow}`, headerRow, lastRow, dates, label, rows: outRows });
  });
  return weeks;
}

/** Valida que `a1` sea editable según el modelo VIVO de la hoja (nunca confiar en el cliente). */
export function findCalendarCell(weeks: CalendarWeek[], a1: string): { week: CalendarWeek; row: CalendarRow; cell: CalendarCell } | null {
  const pos = parseA1(a1);
  if (!pos) return null;
  for (const week of weeks) {
    if (pos.row < week.headerRow || pos.row > week.lastRow) continue;
    const row = week.rows.find((r) => r.rowNumber === pos.row);
    const cell = row?.cells.find((c) => c.a1 === a1.toUpperCase());
    if (row && cell) return { week, row, cell };
  }
  return null;
}
