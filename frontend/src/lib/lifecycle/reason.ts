/**
 * Motivo opcional para Eliminar / Anular / Cancelar / Archivar / Restaurar.
 * Vacío → auditoría con texto canónico; con texto → sanitizado completo.
 */

export const SIN_MOTIVO_INFORMADO = "Sin motivo informado";

/** Limpia espacios/control; no inventa texto. */
export function sanitizeOptionalReason(
  raw: string | null | undefined
): string {
  return String(raw ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Motivo para persistir en auditoría / APIs.
 * Vacío o solo whitespace → "Sin motivo informado".
 */
export function normalizeOptionalReason(
  raw: string | null | undefined
): string {
  const cleaned = sanitizeOptionalReason(raw);
  return cleaned.length > 0 ? cleaned : SIN_MOTIVO_INFORMADO;
}
