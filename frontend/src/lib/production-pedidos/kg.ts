/** Cálculo y parseo de KG para Pedidos de Producción. */
export function parseOptionalDecimal(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const t = String(raw).trim();
  if (!t) return null;
  const normalized = t.replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** KG = (Q × ML) / 1000. Vacío si falta Q o ML. */
export function computeKg(
  q: number | null | undefined,
  ml: number | null | undefined
): number | null {
  if (q == null || ml == null) return null;
  if (!Number.isFinite(q) || !Number.isFinite(ml)) return null;
  return (q * ml) / 1000;
}

/** Hasta 3 decimales sin ceros innecesarios. */
export function formatKg(kg: number | null | undefined): string {
  if (kg == null || !Number.isFinite(kg)) return "";
  const rounded = Math.round(kg * 1000) / 1000;
  return String(Number(rounded.toFixed(3)));
}

export function assertKgMatches(
  q: number | null | undefined,
  ml: number | null | undefined,
  kg: number | null | undefined
): boolean {
  const expected = computeKg(q, ml);
  if (expected == null && (kg == null || kg === undefined)) return true;
  if (expected == null || kg == null) return false;
  return Math.abs(expected - kg) < 1e-9;
}
