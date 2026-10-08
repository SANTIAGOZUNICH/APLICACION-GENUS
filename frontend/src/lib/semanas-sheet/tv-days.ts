/**
 * Días a mostrar en el Modo TV (PURO). Nunca se inventan datos: si hoy no está en la planilla se usa la fecha
 * más cercana que SÍ tiene planificación y se informa (`reason`).
 */
import type { CalendarWeek } from "./calendar-model";
import type { WeekModel } from "./calendar-tasks";

export interface TvDay {
  date: string;
  weekId: string;
  d: number;
}
export interface TvDayPick {
  days: TvDay[];
  /** Presente si la fecha de referencia NO es hoy. */
  reason: string | null;
}

export function listPlannedDays(weeks: CalendarWeek[], models: WeekModel[]): TvDay[] {
  const out: TvDay[] = [];
  weeks.forEach((w, i) => {
    const m = models[i];
    w.dates.forEach((date, d) => {
      if (!date) return;
      const has = m?.sections.some((s) => s.tasks.some((t) => t.d === d || (t.d < d && t.d + t.span - 1 >= d)));
      if (has) out.push({ date, weekId: w.id, d });
    });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** `count` días consecutivos CON planificación a partir del de referencia (hoy, o el más cercano). */
export function pickTvDays(planned: TvDay[], today: string, count: number): TvDayPick {
  if (planned.length === 0) return { days: [], reason: null };
  let idx = planned.findIndex((p) => p.date >= today);
  let reason: string | null = null;
  if (idx < 0) {
    idx = Math.max(0, planned.length - count);
    reason = `La planilla no tiene planificación posterior a hoy (${today}); se muestran los últimos días cargados.`;
  } else if (planned[idx]!.date !== today) {
    reason = `Hoy (${today}) no tiene planificación en la planilla; se muestra el próximo día cargado.`;
  }
  return { days: planned.slice(idx, idx + count), reason };
}
