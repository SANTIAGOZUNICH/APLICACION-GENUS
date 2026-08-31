/**
 * Normalización de números OE para asignación de trabajos — mismo patrón
 * que oa-assign-helpers.ts (formato "{PREFIJO}-YYYY-######"). La
 * compatibilidad de datos (evaluateOaCompatibility/formatOaCompatibilityMessage)
 * ya es genérica sobre product/client/lot/vto/code — se reutiliza tal cual
 * desde oa-assign-helpers.ts en vez de duplicarla acá.
 */

export const OE_NUMBER_PATTERN = /^OE-\d{4}-\d{1,8}$/;

/** trim + uppercase; colapsa espacios internos. */
export function normalizeOeOrderNumber(raw: string | null | undefined): string {
  if (raw == null) return "";
  return String(raw).trim().replace(/\s+/g, "").toUpperCase();
}

export function isValidOeOrderNumber(normalized: string): boolean {
  return OE_NUMBER_PATTERN.test(normalized);
}

/** Extrae año y secuencia numérica de OE-YYYY-######. */
export function parseOeOrderNumber(
  normalized: string
): { year: number; seq: number } | null {
  const m = normalized.match(/^OE-(\d{4})-(\d{1,8})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const seq = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(seq) || seq < 1) return null;
  return { year, seq };
}
