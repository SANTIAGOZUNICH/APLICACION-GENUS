/**
 * Identidad de materiales ME: únicamente por CÓDIGO.
 * No inferir ni coincidir por nombre / descripción / similitud.
 */

/** Normaliza código: trim, colapsa espacios internos, mayúsculas. */
export function normalizeMeCodigo(codigo: string | null | undefined): string {
  if (codigo == null) return "";
  return String(codigo).trim().replace(/\s+/g, " ").toUpperCase();
}

/** true si tras normalizar queda un código usable. */
export function hasMeCodigo(codigo: string | null | undefined): boolean {
  return normalizeMeCodigo(codigo).length > 0;
}

export const ME_CODIGO_REQUIRED_MSG =
  "El código del material es obligatorio. No se puede inferir desde el nombre o la descripción.";
