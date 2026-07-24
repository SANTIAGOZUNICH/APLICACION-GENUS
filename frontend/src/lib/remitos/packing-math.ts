/**
 * Cálculo y advertencias Cajas × Unidades vs Total.
 */
export function computeCajasProduct(
  cajas: number | null | undefined,
  unidadesPorCaja: number | null | undefined
): number | null {
  if (
    cajas == null ||
    unidadesPorCaja == null ||
    !Number.isFinite(cajas) ||
    !Number.isFinite(unidadesPorCaja)
  ) {
    return null;
  }
  return Math.round(cajas * unidadesPorCaja * 1000) / 1000;
}

export function packingTotalMismatchWarning(
  totalUnits: number | null | undefined,
  cajas: number | null | undefined,
  unidadesPorCaja: number | null | undefined
): { ok: boolean; calculated: number | null; difference: number | null; message: string | null } {
  const calculated = computeCajasProduct(cajas, unidadesPorCaja);
  if (calculated == null || totalUnits == null || !Number.isFinite(totalUnits)) {
    return { ok: true, calculated, difference: null, message: null };
  }
  const difference = Math.round((totalUnits - calculated) * 1000) / 1000;
  if (difference === 0) {
    return { ok: true, calculated, difference: 0, message: null };
  }
  return {
    ok: false,
    calculated,
    difference,
    message: `Cajas × unidades (${calculated}) no coincide con Total (${totalUnits}). Diferencia: ${difference}. No se corrige automáticamente.`,
  };
}
