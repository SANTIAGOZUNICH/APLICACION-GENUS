const TZ = "America/Argentina/Buenos_Aires";
export const fmtNumber = (n: number) => new Intl.NumberFormat("es-AR").format(n);
export const fmtQty = (n: number | null | undefined, unit: string | null | undefined) => (n == null ? "—" : `${fmtNumber(n)}${unit ? ` ${unit}` : ""}`);
export const fmtDate = (iso: string) => new Intl.DateTimeFormat("es-AR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
export const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat("es-AR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) + " h";
/** «2026-10-19» (fecha de calendario sin hora) → 19/10/2026. */
export const fmtIsoDay = (day: string) => day.split("-").reverse().join("/");
export const days = (n: number) => `${n} ${n === 1 ? "día hábil" : "días hábiles"}`;
