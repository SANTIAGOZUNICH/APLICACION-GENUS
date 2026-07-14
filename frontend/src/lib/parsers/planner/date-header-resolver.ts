/**
 * Resolución de encabezados de fecha humanos / nativos del planner SEMANAS 2026.
 * El Sheet muestra formatos tipo "martes 14 julio" (number format dddd d mmmm).
 */

import {
  dayOfWeekName,
  toIsoDate,
  weekStartMonday,
} from "@/lib/operational/operational-calendar";

export const SEMANAS_OPERATIONAL_YEAR = 2026;

export type DateResolutionMethod =
  | "native_date"
  | "full_human_header"
  | "split_header"
  | "inherited_week_context";

export interface ResolvedColumnDate {
  plannedDate: string;
  dayOfWeek: string;
  dayLabel: string;
  dayNumber: number;
  monthIndex: number;
  year: number;
  headerText: string;
  method: DateResolutionMethod;
  weekdayMismatch: boolean;
  warning?: string;
}

const MONTH_INDEX: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const DAY_CANONICAL: Record<string, string> = {
  lunes: "Lunes",
  lun: "Lunes",
  martes: "Martes",
  mar: "Martes",
  miercoles: "Miércoles",
  miércoles: "Miércoles",
  mie: "Miércoles",
  mié: "Miércoles",
  jueves: "Jueves",
  jue: "Jueves",
  viernes: "Viernes",
  vie: "Viernes",
  sabado: "Sábado",
  sábado: "Sábado",
  sab: "Sábado",
  sáb: "Sábado",
  domingo: "Domingo",
  dom: "Domingo",
};

const WORKDAY_ORDER = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"] as const;

export function normalizeHeaderKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

export function isMonthName(value: string): boolean {
  const key = normalizeHeaderKey(value);
  return key in MONTH_INDEX;
}

export function monthNameToIndex(value: string): number | null {
  const key = normalizeHeaderKey(value);
  return MONTH_INDEX[key] ?? null;
}

export function columnIndexToLetter(index0: number): string {
  let n = index0 + 1;
  let result = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function buildResolved(
  year: number,
  month: number,
  day: number,
  headerText: string,
  method: DateResolutionMethod,
  expectedWeekday?: string | null
): ResolvedColumnDate | null {
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;

  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  const plannedDate = toIsoDate(year, month, day);
  const actualWeekday = dayOfWeekName(plannedDate);
  const expected = expectedWeekday
    ? DAY_CANONICAL[normalizeHeaderKey(expectedWeekday)] ?? expectedWeekday
    : null;
  const weekdayMismatch = Boolean(expected && expected !== actualWeekday);

  return {
    plannedDate,
    dayOfWeek: actualWeekday,
    dayLabel: expected && !weekdayMismatch ? expected : actualWeekday,
    dayNumber: day,
    monthIndex: month,
    year,
    headerText,
    method,
    weekdayMismatch,
    warning: weekdayMismatch
      ? `Día de semana incompatible: encabezado «${headerText}» → ${plannedDate} es ${actualWeekday}, no ${expected}`
      : undefined,
  };
}

/** ISO / dd/mm(/yyyy) — nativo Sheets o export. */
export function parseNativeDateCell(
  raw: string,
  year = SEMANAS_OPERATIONAL_YEAR
): ResolvedColumnDate | null {
  const text = raw.trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (iso) {
    return buildResolved(
      Number(iso[1]),
      Number(iso[2]),
      Number(iso[3]),
      text,
      "native_date"
    );
  }

  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let y = dmy[3] ? Number(dmy[3]) : year;
    if (y < 100) y += 2000;
    return buildResolved(y, month, day, text, "native_date");
  }

  return null;
}

/**
 * Encabezado humano: "Martes 14 de julio", "martes 14 julio", "MAR 14 JULIO",
 * "Martes / 14 de julio", etc.
 */
export function parseHumanDateHeader(
  raw: string,
  year = SEMANAS_OPERATIONAL_YEAR
): ResolvedColumnDate | null {
  const text = raw.trim();
  if (!text) return null;

  const native = parseNativeDateCell(text, year);
  if (native) return native;

  const key = normalizeHeaderKey(text)
    .replace(/[./|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // "martes 14 de julio" | "martes 14 julio" | "mar 14 julio"
  const withWeekday = key.match(
    /^(lunes|martes|miercoles|jueves|viernes|sabado|domingo|lun|mar|mie|jue|vie|sab|dom)\s+(\d{1,2})\s*(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/
  );
  if (withWeekday) {
    const weekdayToken = withWeekday[1];
    const day = Number(withWeekday[2]);
    const month = MONTH_INDEX[withWeekday[3]];
    return buildResolved(year, month, day, text, "full_human_header", weekdayToken);
  }

  // "14 de julio" | "14 julio"
  const dayMonth = key.match(
    /^(\d{1,2})\s*(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/
  );
  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const month = MONTH_INDEX[dayMonth[2]];
    return buildResolved(year, month, day, text, "full_human_header");
  }

  return null;
}

/** Día + mes separados (filas numéricas + fila de mes). */
export function resolveSplitColumnDate(
  dayNumber: string | null | undefined,
  monthLabel: string | null | undefined,
  year = SEMANAS_OPERATIONAL_YEAR,
  expectedWeekday?: string | null
): ResolvedColumnDate | null {
  if (!dayNumber?.trim() || !monthLabel?.trim()) return null;
  const day = Number(String(dayNumber).replace(/\.0$/, "").trim());
  const month = monthNameToIndex(monthLabel);
  if (!month) return null;
  const headerText = `${dayNumber} ${monthLabel}`.trim();
  return buildResolved(year, month, day, headerText, "split_header", expectedWeekday);
}

export function resolveDateHeaderCell(
  raw: string,
  year = SEMANAS_OPERATIONAL_YEAR
): ResolvedColumnDate | null {
  return parseHumanDateHeader(raw, year);
}

/** ¿La fila tiene ≥3 celdas con fecha resoluble (humana, ISO o dd/mm)? */
export function countResolvableDateCells(
  row: string[],
  year = SEMANAS_OPERATIONAL_YEAR
): number {
  let count = 0;
  for (const cell of row) {
    if (resolveDateHeaderCell(cell, year)) count += 1;
  }
  return count;
}

export interface ExtractedDateHeaderRow {
  dayColumns: Map<number, string>;
  columnDates: Map<number, ResolvedColumnDate>;
  warnings: string[];
  samples: Array<{
    colIndex: number;
    dayColumn: string;
    headerText: string;
    resolvedDate: string;
    method: DateResolutionMethod;
  }>;
}

/** Extrae fechas por columna desde una fila de encabezado (no asume un único mes). */
export function extractColumnDatesFromHeaderRow(
  row: string[],
  year = SEMANAS_OPERATIONAL_YEAR
): ExtractedDateHeaderRow {
  const dayColumns = new Map<number, string>();
  const columnDates = new Map<number, ResolvedColumnDate>();
  const warnings: string[] = [];
  const samples: ExtractedDateHeaderRow["samples"] = [];

  const resolved: Array<{ col: number; date: ResolvedColumnDate }> = [];
  row.forEach((cell, col) => {
    const parsed = resolveDateHeaderCell(cell, year);
    if (!parsed) return;
    resolved.push({ col, date: parsed });
  });

  // Ordenar por fecha para etiquetar si faltara weekday; preferir weekday del encabezado.
  resolved.sort((a, b) => a.date.plannedDate.localeCompare(b.date.plannedDate));

  resolved.forEach(({ col, date }, idx) => {
    if (date.warning) warnings.push(date.warning);
    const label =
      date.dayLabel ||
      WORKDAY_ORDER[idx] ||
      dayOfWeekName(date.plannedDate);
    const next: ResolvedColumnDate = {
      ...date,
      dayLabel: label,
      dayOfWeek: date.dayOfWeek || label,
    };
    dayColumns.set(col, label);
    columnDates.set(col, next);
    samples.push({
      colIndex: col,
      dayColumn: columnIndexToLetter(col),
      headerText: date.headerText,
      resolvedDate: date.plannedDate,
      method: date.method,
    });
  });

  return { dayColumns, columnDates, warnings, samples };
}

export function markInherited(date: ResolvedColumnDate): ResolvedColumnDate {
  if (date.method === "inherited_week_context") return date;
  return { ...date, method: "inherited_week_context" };
}

export function weekStartFromColumnDates(
  columnDates: Map<number, ResolvedColumnDate>
): string | null {
  let earliest: string | null = null;
  for (const d of columnDates.values()) {
    if (!earliest || d.plannedDate < earliest) earliest = d.plannedDate;
  }
  return earliest ? weekStartMonday(earliest) : null;
}
