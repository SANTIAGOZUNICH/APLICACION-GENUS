/**
 * Semáforo de disponibilidad de MP — reglas PURAS compartidas por el Control semanal (por producto y consolidado) y por
 * el mini control individual. Siempre va acompañado de TEXTO (el color nunca es la única señal).
 *
 *   VERDE    SUFICIENTE          el stock utilizable cubre la necesidad
 *   AMARILLO FALTANTE PARCIAL    hay stock utilizable, pero no alcanza
 *   ROJO     SIN STOCK           se necesita y el stock utilizable es cero
 *   GRIS     SIN DATOS           MP no identificada o sin información confiable (NUNCA se lee como stock cero)
 */
import type { AvailabilityStatus } from "./availability";

export type Tone = "ok" | "partial" | "none" | "unknown";

export const TONE_LABEL: Record<Tone, string> = { ok: "SUFICIENTE", partial: "FALTANTE PARCIAL", none: "SIN STOCK", unknown: "SIN DATOS" };

export function toneOfStatus(status: AvailabilityStatus): Tone {
  switch (status) {
    case "SUFICIENTE":
      return "ok";
    case "FALTANTE":
      return "partial";
    case "SIN STOCK":
    case "SIN STOCK UTILIZABLE":
      return "none";
    default:
      return "unknown"; // MP NO IDENTIFICADA · DATOS INCOMPLETOS
  }
}

/** Texto del estado (más específico que el semáforo cuando ayuda a entender). */
export function statusLabel(status: AvailabilityStatus): string {
  if (status === "FALTANTE") return "FALTANTE PARCIAL";
  if (status === "MP NO IDENTIFICADA") return "NO IDENTIFICADA";
  if (status === "DATOS INCOMPLETOS") return "SIN DATOS";
  return status;
}

/** Clasifica una necesidad contra un stock utilizable. `identified=false` o necesidad/stock desconocidos → gris. */
export function toneOfNumbers(p: { need: number | null; usable: number | null; identified?: boolean }): Tone {
  if (p.identified === false || p.need == null || p.usable == null || !Number.isFinite(p.need) || !Number.isFinite(p.usable)) return "unknown";
  if (p.need <= 0) return "ok";
  if (p.usable <= 0) return "none";
  return p.usable + 1e-9 >= p.need ? "ok" : "partial";
}

/** Clases (tema oscuro de GENUS OS) para insignias y para cantidades. */
export const TONE_BADGE: Record<Tone, string> = {
  ok: "border-emerald-400/70 bg-emerald-400/15 text-emerald-200",
  partial: "border-amber-400/80 bg-amber-400/15 text-amber-200",
  none: "border-rose-500/80 bg-rose-500/15 text-rose-200",
  unknown: "border-slate-400/70 bg-slate-400/15 text-slate-200",
};
export const TONE_VALUE: Record<Tone, string> = { ok: "text-emerald-300", partial: "text-amber-300", none: "text-rose-300", unknown: "text-slate-300" };
/** Fondo suave de la celda para que el color se vea de un vistazo. */
export const TONE_CELL: Record<Tone, string> = { ok: "bg-emerald-400/10", partial: "bg-amber-400/10", none: "bg-rose-500/10", unknown: "bg-slate-400/10" };

/** Un valor negativo siempre se destaca (rojo, negrita), sea cual sea el semáforo de la fila. */
export function valueClass(tone: Tone, value?: number | null): string {
  if (value != null && value < 0) return "font-bold text-rose-300";
  return TONE_VALUE[tone];
}

const nf = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3, useGrouping: false });
export const fmtKg = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : nf.format(n));
export const fmtSigned = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : ""}${nf.format(n)}`);
