/**
 * Vista MENSUAL de la planificación — reglas PURAS. Es la misma planificación que la vista Semanal, con otra perspectiva:
 * agrupa los MISMOS trabajos por día (un trabajo con rango aparece en cada día que cubre, sin clonar su identidad) y separa
 * los que no tienen fecha asignada. No crea ni duplica trabajos.
 */
import type { WorkItem } from "@/types/operational/work-item";

/** Lo mínimo que la vista Mensual necesita de un trabajo (WorkItem y el plan compartido de solo lectura lo cumplen). */
export type MonthItem = Pick<WorkItem, "id" | "product" | "client" | "quantity" | "unit" | "plannedDate" | "plannedDateTo">;
import { workItemCoversDate } from "./work-item-date-range";
import { addDaysIso, parseIsoDate, weekStartMonday } from "./operational-calendar";

export type MonthCell = { date: string; inMonth: boolean };

/** Primer día (AAAA-MM-01) del mes de una fecha ISO. */
export function monthStartOf(iso: string): string {
  const p = parseIsoDate(iso);
  return p ? `${p.year}-${String(p.month).padStart(2, "0")}-01` : iso;
}

/** ±n meses desde el primer día de un mes (siempre devuelve AAAA-MM-01). */
export function addMonths(monthStart: string, n: number): string {
  const p = parseIsoDate(monthStart);
  if (!p) return monthStart;
  const idx = p.year * 12 + (p.month - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}-01`;
}

export function monthEndOf(monthStart: string): string {
  return addDaysIso(addMonths(monthStart, 1), -1);
}

/** Semanas (lunes→domingo) que cubren el mes completo. Cada celda dice si pertenece al mes mostrado. */
export function buildMonthGrid(monthStart: string): MonthCell[][] {
  const first = monthStartOf(monthStart);
  const last = monthEndOf(first);
  const weeks: MonthCell[][] = [];
  for (let wk = weekStartMonday(first); wk <= last; wk = addDaysIso(wk, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => {
      const date = addDaysIso(wk, i);
      return { date, inMonth: date >= first && date <= last };
    }));
  }
  return weeks;
}

/** Rango [from, to] que hay que pedir al servidor para pintar la grilla completa del mes. */
export function monthGridRange(monthStart: string): { from: string; to: string } {
  const grid = buildMonthGrid(monthStart);
  return { from: grid[0]![0]!.date, to: grid[grid.length - 1]![6]!.date };
}

export const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"] as const;
export function monthLabel(monthStart: string): string {
  const p = parseIsoDate(monthStart);
  return p ? `${MONTH_NAMES[p.month - 1]} ${p.year}` : monthStart;
}

/** Trabajos por día de la grilla. Un trabajo sin fecha nunca aparece en un día. */
export function groupItemsByMonthDay<T extends MonthItem>(items: T[], grid: MonthCell[][]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const cell of grid.flat()) out.set(cell.date, items.filter((it) => workItemCoversDate(it, cell.date)));
  return out;
}

/** Trabajos sin fecha asignada (para programarlos después). */
export function undatedItems<T extends MonthItem>(items: T[]): T[] {
  return items.filter((it) => !it.plannedDate?.trim());
}
