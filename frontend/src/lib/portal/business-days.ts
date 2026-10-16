/**
 * Días hábiles argentinos para la cuenta regresiva del Portal de Clientes. Reglas PURAS (sin E/S), en zona horaria de
 * Buenos Aires. Fechas siempre como texto «AAAA-MM-DD» (aritmética en UTC: nunca depende de la zona del servidor).
 *
 * Qué NO se cuenta: sábados, domingos y feriados nacionales (Ley 27.399):
 *  - inamovibles: 1/1, Carnaval (lunes y martes), 24/3, 2/4, Viernes Santo, 1/5, 25/5, 20/6, 9/7, 8/12, 25/12;
 *  - trasladables: 17/6 (Güemes), 17/8 (San Martín), 12/10 (Diversidad Cultural), 20/11 (Soberanía): martes o miércoles
 *    pasan al lunes anterior; jueves o viernes, al lunes siguiente; sábado, domingo y lunes no se mueven.
 * Los «días no laborables con fines turísticos» (puentes, por decreto) NO son feriados: el empleador decide si se trabaja.
 * Por eso no se descuentan salvo que se pida (`includeBridgeDays`). Las excepciones por decreto que cambian una fecha
 * (feriado extra o corrido) se cargan en `HolidayAdjustments` (el servicio las lee de la base).
 */

export const PORTAL_TIMEZONE = "America/Argentina/Buenos_Aires";

export type HolidayKind = "feriado" | "puente";
export type Holiday = { date: string; name: string; kind: HolidayKind };

/** Excepciones por decreto/resolución: días que se suman como feriado y fechas que se quitan del cálculo por regla. */
export type HolidayAdjustments = { add?: Array<{ date: string; name: string }>; remove?: string[] };

/**
 * Días no laborables con fines turísticos, por resolución (los que se confirmaron). Solo informativos:
 * 2026 → Resolución 164/2025 de la Jefatura de Gabinete: 23/3, 10/7 y 7/12.
 */
export const BRIDGE_DAYS: Record<number, Array<{ date: string; name: string }>> = {
  2026: [
    { date: "2026-03-23", name: "Día no laborable con fines turísticos" },
    { date: "2026-07-10", name: "Día no laborable con fines turísticos" },
    { date: "2026-12-07", name: "Día no laborable con fines turísticos" },
  ],
};

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Fecha ISO → `Date` en UTC a medianoche. */
export function isoToUtc(dateIso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if (!m) throw new Error(`Fecha inválida: ${dateIso}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function utcToIso(d: Date): string {
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDaysIso(dateIso: string, days: number): string {
  const d = isoToUtc(dateIso);
  d.setUTCDate(d.getUTCDate() + days);
  return utcToIso(d);
}

/** 0 = domingo … 6 = sábado. */
export const weekdayOf = (dateIso: string) => isoToUtc(dateIso).getUTCDay();

/** Instante → fecha de calendario en Buenos Aires (no usa la zona del servidor). */
export function toBuenosAiresDate(instant: Date | string | number): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) throw new Error("Instante inválido");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: PORTAL_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Domingo de Pascua (algoritmo gregoriano anónimo). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

/** Ley 27.399: feriado trasladable → fecha efectiva. */
export function movableHolidayDate(year: number, month: number, day: number): string {
  const original = iso(year, month, day);
  const wd = weekdayOf(original);
  if (wd === 2 || wd === 3) return addDaysIso(original, -(wd - 1)); // martes/miércoles → lunes anterior
  if (wd === 4 || wd === 5) return addDaysIso(original, 8 - wd); // jueves/viernes → lunes siguiente
  return original; // sábado, domingo y lunes no se mueven
}

const cache = new Map<number, Holiday[]>();

/** Feriados nacionales del año por regla legal (sin excepciones por decreto). */
export function nationalHolidays(year: number): Holiday[] {
  const hit = cache.get(year);
  if (hit) return hit;
  const easter = easterSunday(year);
  const list: Holiday[] = [
    { date: iso(year, 1, 1), name: "Año Nuevo", kind: "feriado" },
    { date: addDaysIso(easter, -48), name: "Carnaval", kind: "feriado" },
    { date: addDaysIso(easter, -47), name: "Carnaval", kind: "feriado" },
    { date: iso(year, 3, 24), name: "Día Nacional de la Memoria por la Verdad y la Justicia", kind: "feriado" },
    { date: iso(year, 4, 2), name: "Día del Veterano y de los Caídos en la Guerra de Malvinas", kind: "feriado" },
    { date: addDaysIso(easter, -2), name: "Viernes Santo", kind: "feriado" },
    { date: iso(year, 5, 1), name: "Día del Trabajador", kind: "feriado" },
    { date: iso(year, 5, 25), name: "Día de la Revolución de Mayo", kind: "feriado" },
    { date: movableHolidayDate(year, 6, 17), name: "Paso a la Inmortalidad del General Martín Miguel de Güemes", kind: "feriado" },
    { date: iso(year, 6, 20), name: "Paso a la Inmortalidad del General Manuel Belgrano", kind: "feriado" },
    { date: iso(year, 7, 9), name: "Día de la Independencia", kind: "feriado" },
    { date: movableHolidayDate(year, 8, 17), name: "Paso a la Inmortalidad del General José de San Martín", kind: "feriado" },
    { date: movableHolidayDate(year, 10, 12), name: "Día del Respeto a la Diversidad Cultural", kind: "feriado" },
    { date: movableHolidayDate(year, 11, 20), name: "Día de la Soberanía Nacional", kind: "feriado" },
    { date: iso(year, 12, 8), name: "Inmaculada Concepción de María", kind: "feriado" },
    { date: iso(year, 12, 25), name: "Navidad", kind: "feriado" },
  ];
  cache.set(year, list);
  return list;
}

export type BusinessCalendarOptions = {
  adjustments?: HolidayAdjustments;
  /** Descontar también los días no laborables con fines turísticos (por defecto no: no son feriados). */
  includeBridgeDays?: boolean;
};

/** Mapa fecha → nombre de los días NO hábiles entre feriados (no incluye fines de semana). */
export function holidayMap(years: number[], opts: BusinessCalendarOptions = {}): Map<string, Holiday> {
  const out = new Map<string, Holiday>();
  for (const y of new Set(years)) {
    for (const h of nationalHolidays(y)) out.set(h.date, h);
    if (opts.includeBridgeDays) for (const b of BRIDGE_DAYS[y] ?? []) out.set(b.date, { ...b, kind: "puente" });
  }
  for (const r of opts.adjustments?.remove ?? []) out.delete(r);
  for (const a of opts.adjustments?.add ?? []) out.set(a.date, { date: a.date, name: a.name, kind: "feriado" });
  return out;
}

/** Calendario con consultas por fecha (construye los años que haga falta). */
export function businessCalendar(opts: BusinessCalendarOptions = {}) {
  const maps = new Map<number, Map<string, Holiday>>();
  const forYear = (y: number) => {
    let m = maps.get(y);
    if (!m) {
      m = holidayMap([y], opts);
      maps.set(y, m);
    }
    return m;
  };
  const holidayOn = (dateIso: string): Holiday | null => {
    const y = Number(dateIso.slice(0, 4));
    return forYear(y).get(dateIso) ?? null;
  };
  const isBusinessDay = (dateIso: string) => {
    const wd = weekdayOf(dateIso);
    return wd !== 0 && wd !== 6 && !holidayOn(dateIso);
  };
  /** Días hábiles en (desde, hasta]: el día de «desde» no cuenta, el de «hasta» sí. 0 si hasta <= desde. */
  const businessDaysBetween = (fromIso: string, toIso: string) => {
    if (toIso <= fromIso) return 0;
    let n = 0;
    for (let d = addDaysIso(fromIso, 1); d <= toIso; d = addDaysIso(d, 1)) if (isBusinessDay(d)) n++;
    return n;
  };
  /** Fecha tras sumar `n` días hábiles a partir de `fromIso` (el propio día de inicio no cuenta). */
  const addBusinessDays = (fromIso: string, n: number) => {
    let d = fromIso;
    let left = n;
    while (left > 0) {
      d = addDaysIso(d, 1);
      if (isBusinessDay(d)) left--;
    }
    return d;
  };
  return { isBusinessDay, holidayOn, businessDaysBetween, addBusinessDays };
}

export type Countdown = {
  /** Fecha (Buenos Aires) en la que la etapa se registró realmente. */
  startDate: string;
  totalDays: number;
  elapsedDays: number;
  /** Nunca negativo. */
  remainingDays: number;
  /** Fecha estimada de fin de la etapa (solo orientativa, no es un compromiso). */
  estimatedDate: string;
  overdue: boolean;
  /** 0–100, para la barra de la etapa. */
  progressPct: number;
};

/**
 * Cuenta regresiva de una etapa: el día de ingreso no cuenta y cada día hábil posterior descuenta uno.
 * Si la etapa no tiene un inicio verificable (`startedAt` nulo o inválido) devuelve null: NUNCA se inventa una fecha.
 */
export function stageCountdown(
  startedAt: Date | string | number | null | undefined,
  now: Date | string | number,
  totalDays: number,
  opts: BusinessCalendarOptions = {}
): Countdown | null {
  if (startedAt == null || startedAt === "") return null;
  const start = startedAt instanceof Date ? startedAt : new Date(startedAt);
  if (Number.isNaN(start.getTime())) return null;
  const cal = businessCalendar(opts);
  const startDate = toBuenosAiresDate(start);
  const today = toBuenosAiresDate(now);
  const elapsedDays = Math.min(totalDays, cal.businessDaysBetween(startDate, today));
  const remainingDays = Math.max(0, totalDays - elapsedDays);
  return {
    startDate,
    totalDays,
    elapsedDays,
    remainingDays,
    estimatedDate: cal.addBusinessDays(startDate, totalDays),
    overdue: today > startDate && cal.businessDaysBetween(startDate, today) > totalDays,
    progressPct: totalDays > 0 ? Math.round((elapsedDays / totalDays) * 100) : 100,
  };
}
