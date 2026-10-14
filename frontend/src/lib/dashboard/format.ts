/** Formato es-AR compartido por el cálculo (resumen gerencial) y la pantalla. */

const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];
const MONTH_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? String(month);
}
export function monthShort(month: number): string {
  return MONTH_SHORT[month - 1] ?? String(month);
}

export function periodText(year: number, month: number | null): string {
  return month ? `${monthName(month)} ${year}` : `Año ${year}`;
}

const intFmt = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const dec1Fmt = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function fmtInt(n: number): string {
  return intFmt.format(Math.round(n));
}
export function fmtDec1(n: number): string {
  return dec1Fmt.format(n);
}
export function fmtPercent(n: number): string {
  return `${dec1Fmt.format(n)} %`;
}
export function fmtDays(n: number): string {
  return `${dec1Fmt.format(n)} días`;
}
