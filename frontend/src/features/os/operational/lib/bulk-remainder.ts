/** Parseo de sobrante de granel (kg) — coma o punto; vacío/0 = sin registro. */

export function parseBulkRemainderKg(raw: string | null | undefined): {
  ok: true;
  kg: number | null;
} | { ok: false; error: string } {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: true, kg: null };
  const normalized = text.replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    return { ok: false, error: "Ingresá un número válido en kg (ej. 12,5)." };
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    return { ok: false, error: "Ingresá un número válido en kg." };
  }
  if (value < 0) {
    return { ok: false, error: "El sobrante de granel no puede ser negativo." };
  }
  if (value === 0) return { ok: true, kg: null };
  return { ok: true, kg: value };
}

export function formatBulkRemainderKg(kg: number): string {
  return kg.toLocaleString("es-AR", { maximumFractionDigits: 3 });
}
