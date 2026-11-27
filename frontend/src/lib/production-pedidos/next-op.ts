/**
 * Siguiente N° de OP correlativo y fecha «hoy» (Argentina) para el alta de Pedidos de Producción.
 *
 * El campo `production_pedidos.op` es TEXTO libre; los OP reales del sistema son numéricos (p. ej. «25293»). El siguiente OP
 * es MAX(OP numérico) + 1 sobre TODAS las filas (incluidas las eliminadas, para no reutilizar nunca un N° ya impreso).
 * Sin ningún OP numérico previo no hay nada que autocompletar (null). Módulo puro: sin dependencias de servidor.
 */

/** Un OP «numérico» es solo dígitos (hasta 15, seguro en doble precisión / bigint). Todo lo demás (p. ej. «PDEP-1») se ignora. */
export const NUMERIC_OP_RE = /^\d{1,15}$/;

export function parseNumericOp(raw: string | null | undefined): bigint | null {
  const t = String(raw ?? "").trim();
  return NUMERIC_OP_RE.test(t) ? BigInt(t) : null;
}

/** Formatea `n` conservando el ancho (ceros a la izquierda) del OP de referencia. */
export function formatOpLike(reference: string, n: bigint): string {
  const ref = reference.trim();
  const s = n.toString();
  return ref.length > s.length && ref.startsWith("0") ? s.padStart(ref.length, "0") : s;
}

/** Siguiente OP a partir de una lista de OP existentes (cualquier texto). null si no hay ninguno numérico. */
export function computeNextOp(existing: Iterable<string | null | undefined>): string | null {
  let max: bigint | null = null;
  let maxRaw = "";
  for (const raw of existing) {
    const n = parseNumericOp(raw);
    if (n != null && (max == null || n > max)) {
      max = n;
      maxRaw = String(raw).trim();
    }
  }
  return max == null ? null : formatOpLike(maxRaw, max + BigInt(1));
}

export const AR_TIME_ZONE = "America/Argentina/Buenos_Aires";

/** Fecha «hoy» según Buenos Aires (no la hora del navegador ni del servidor UTC), en ISO `YYYY-MM-DD` (formato guardado). */
export function todayIsoArgentina(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: AR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** `YYYY-MM-DD` → `DD/MM/AA` (año de dos dígitos). Valores no ISO se devuelven tal cual. */
export function isoToDdMmAa(iso: string | null | undefined): string {
  const m = String(iso ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : String(iso ?? "");
}

/** Hoy en Buenos Aires mostrado como `DD/MM/AA`. */
export function todayDdMmAaArgentina(now: Date = new Date()): string {
  return isoToDdMmAa(todayIsoArgentina(now));
}
