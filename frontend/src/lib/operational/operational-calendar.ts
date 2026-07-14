/**
 * Calendario operativo — zona America/Argentina/Buenos_Aires.
 * Source of truth para “Hoy” en /mi-trabajo.
 */

export const OPERATIONAL_TIMEZONE = "America/Argentina/Buenos_Aires";

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

const DAY_NAMES = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
] as const;

const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

/** Fecha civil de hoy en Buenos Aires (YYYY-MM-DD). */
export function todayInBuenosAires(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATIONAL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Partes de fecha en Buenos Aires. */
export function buenosAiresDateParts(now = new Date()): {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: OPERATIONAL_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(now);

  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return { year, month, day, dayOfWeek: map[weekday] ?? 1 };
}

export function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseIsoDate(iso: string): { year: number; month: number; day: number } | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function addDaysIso(iso: string, days: number): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) return iso;
  const utc = Date.UTC(parsed.year, parsed.month - 1, parsed.day + days);
  const d = new Date(utc);
  return toIsoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Lunes de la semana laboral (ISO date) que contiene `iso`. */
export function weekStartMonday(iso: string): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) return iso;
  const utc = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  const day = new Date(utc).getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDaysIso(iso, diff);
}

export function workWeekDays(weekStart: string): string[] {
  return [0, 1, 2, 3, 4].map((offset) => addDaysIso(weekStart, offset));
}

export function dayOfWeekName(iso: string): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) return "";
  const utc = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  return DAY_NAMES[new Date(utc).getUTCDay()];
}

export function formatOperationalLongDate(iso: string): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) return iso;
  const name = dayOfWeekName(iso);
  return `${name} ${parsed.day} de ${MONTH_NAMES[parsed.month - 1]}`;
}

export function formatOperationalDayHeading(iso: string, todayIso: string): string {
  const long = formatOperationalLongDate(iso);
  if (iso === todayIso) return `Hoy · ${long.toLowerCase()}`;
  return long;
}

/** Resuelve día + mes textual (+ año spreadsheet) → YYYY-MM-DD. */
export function resolvePlannedDateIso(
  dayNumber: string | null | undefined,
  monthLabel: string | null | undefined,
  year = 2026
): string | null {
  if (!dayNumber?.trim() || !monthLabel?.trim()) return null;
  const day = Number(String(dayNumber).replace(/\.0$/, "").trim());
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;

  const monthKey = monthLabel
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const month = MONTH_INDEX[monthKey];
  if (!month) return null;

  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  return toIsoDate(year, month, day);
}

export function resolveWeekId(plannedDate: string | null): string | null {
  if (!plannedDate) return null;
  const monday = weekStartMonday(plannedDate);
  return monday;
}
