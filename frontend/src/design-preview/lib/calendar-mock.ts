/** F9.1 — calendario mock para preview (sin backend). */

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Lunes de la semana laboral que contiene `date`. */
export function getMonday(date: Date): Date {
  const d = startOfDay(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

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
];

export function formatLongDate(date: Date): string {
  const name = DAY_NAMES[date.getDay()];
  return `${name} ${date.getDate()} de ${MONTH_NAMES[date.getMonth()]} de ${date.getFullYear()}`;
}

export function formatShortDay(date: Date): string {
  return DAY_NAMES[date.getDay()];
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Lunes a viernes de la semana laboral actual (relativa a `anchor`). */
export function getWorkWeekDays(anchor: Date): Date[] {
  const monday = getMonday(anchor);
  return [0, 1, 2, 3, 4].map((offset) => addDays(monday, offset));
}

export function isSameDay(a: Date, b: Date): boolean {
  return toIsoDate(a) === toIsoDate(b);
}

export function isToday(date: Date, today: Date): boolean {
  return isSameDay(date, today);
}

export function isTomorrow(date: Date, today: Date): boolean {
  return isSameDay(date, addDays(today, 1));
}

export function deliveryLabelFor(workDate: Date, deliveryDate: Date, today: Date): string {
  if (isSameDay(deliveryDate, today)) return "Hoy";
  if (isSameDay(deliveryDate, addDays(today, 1))) return "Mañana";
  return formatShortDay(deliveryDate);
}
