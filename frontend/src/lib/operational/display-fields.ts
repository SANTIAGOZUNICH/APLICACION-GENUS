/** Etiqueta estándar cuando un campo no está en la planilla — nunca inventar datos. */
export const DATO_NO_DISPONIBLE = "Dato no disponible";

export function displayField(value: string | null | undefined): string {
  if (value == null || !value.trim()) return DATO_NO_DISPONIBLE;
  return value.trim();
}

export function normalizePersonName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  return trimmed
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function personNamesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const na = a
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const nb = b
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return na === nb || na.startsWith(nb) || nb.startsWith(na);
}
