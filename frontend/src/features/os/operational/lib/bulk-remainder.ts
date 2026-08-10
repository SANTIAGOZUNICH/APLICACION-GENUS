/**
 * Parseo de sobrante de granel (kg) — coma o punto decimal (AR).
 * Vacío (campo nunca tocado) = null: "no informado".
 * "0" tipeado explícitamente = 0: "confirmó que no sobró nada" — distinto de
 * no informado. NUNCA colapsar 0 a null acá (ver AUDIT_TRAZABILIDAD, H):
 * el llamador decide si 0 amerita crear un registro en Depósito (no), pero
 * el valor persistido en work_items.bulk_remainder_kg debe preservar el 0
 * real para que Producción pueda mostrar "Sobrante: 0 kg" en vez de "—".
 */
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
  return { ok: true, kg: value };
}

/** true solo si hay sobrante > 0 a registrar en Depósito (0/null = nada que crear). */
export function hasRegistrableBulkRemainder(kg: number | null | undefined): kg is number {
  return typeof kg === "number" && Number.isFinite(kg) && kg > 0;
}

export function formatBulkRemainderKg(kg: number): string {
  return kg.toLocaleString("es-AR", { maximumFractionDigits: 3 });
}
