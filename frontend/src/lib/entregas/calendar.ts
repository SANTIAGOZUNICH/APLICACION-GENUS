/** Calendario mensual de Entregas: grilla lunes→domingo (lógica pura, sin zona horaria: todo en fechas ISO yyyy-mm-dd). */

export interface CalendarDay {
  iso: string;
  day: number;
  inMonth: boolean;
}

export const WEEKDAYS_ES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"] as const;
const MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const pad = (n: number) => String(n).padStart(2, "0");
export const toIso = (y: number, m1: number, d: number) => `${y}-${pad(m1)}-${pad(d)}`;

/** Suma días a una fecha ISO (UTC, sin saltos por horario de verano). */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return toIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Semanas completas (lunes a domingo) que cubren el mes `month` (1–12). 5 o 6 filas. */
export function monthGrid(year: number, month: number): CalendarDay[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7; // lunes = 0
  const start = addDaysIso(toIso(year, month, 1), -offset);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7;
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < totalCells; i += 7) {
    const week: CalendarDay[] = [];
    for (let j = 0; j < 7; j += 1) {
      const iso = addDaysIso(start, i + j);
      const [, m, d] = iso.split("-").map(Number) as [number, number, number];
      week.push({ iso, day: d, inMonth: m === month });
    }
    weeks.push(week);
  }
  return weeks;
}

/** Rango ISO que cubre la grilla visible del mes (para pedir las entregas al servidor). */
export function gridRange(year: number, month: number): { from: string; to: string } {
  const g = monthGrid(year, month);
  return { from: g[0]![0]!.iso, to: g[g.length - 1]![6]!.iso };
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export const monthLabel = (year: number, month: number) => `${MONTHS_ES[month - 1]} ${year}`;

export function longDateLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dow = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
  return `${dow} ${d} de ${MONTHS_ES[m - 1]} de ${y}`;
}

export const shortDateLabel = (iso: string) => iso.split("-").reverse().join("/");
