/**
 * Cierre de packaging (cajas) del circuito operativo — reglas compartidas por el handoff Envasado→Codificado,
 * la entrega desde Codificado y la entrega directa desde Envasado.
 *
 * EXCEPCIÓN DE CAJAS (solo Envasado→Codificado): al enviar a Codificado NO se exigen cajas, distribución ni
 * unidades por caja; alcanza la cantidad total de unidades. Eso se aplica en el SERVIDOR (no solo ocultando campos):
 * `closeForCodificadoTransfer` no valida la distribución y nunca guarda una distribución ficticia. Si el trabajo
 * trae una distribución REAL y consistente con el total, se conserva y se registra el cierre; si no, se deja tal cual.
 *
 * ENTREGA DIRECTA DESDE ENVASADO: NO aplica la excepción. `assertEnvasadoDeliveryBoxes` exige distribución de cajas y
 * valida contra la cantidad producida (con la excepción ya existente de diferencia justificada por observación).
 */
import { computePackagingClose, normalizePackingGroups } from "@/lib/remitos/packing-math";
import { PlanningValidationError } from "@/lib/planning/types";

type RawGroups = Array<{ cajas?: number; unidadesPorCaja?: number }> | null | undefined;

/** ¿Hay una distribución REAL (al menos un grupo con cajas y unidades por caja > 0)? */
export function hasRealPackingGroups(groups: unknown): boolean {
  const normalized = normalizePackingGroups((groups as RawGroups) ?? []);
  return normalized.some((g) => g.cajas > 0 && g.unidadesPorCaja > 0);
}

/**
 * Valida el cierre físico (PARTE A) antes de dejar avanzar una entrega con cajas. Excepción ya autorizada en el
 * sistema: si hay una observación de embalaje se documenta la diferencia y se permite continuar.
 */
export function assertPackagingCloseOrExplained(params: {
  finishedQty: number | null | undefined;
  sampleUnits: number | null | undefined;
  packingGroups: unknown;
  observation: string | null | undefined;
}): ReturnType<typeof computePackagingClose> {
  const groups = normalizePackingGroups((params.packingGroups as RawGroups) ?? []);
  const close = computePackagingClose({
    finishedQty: params.finishedQty,
    sampleUnits: params.sampleUnits,
    groups,
  });
  if (close.canValidate && !close.isValid && !params.observation?.trim()) {
    // Regla definitiva: muestras es metadata, no compensa la diferencia entre producido y embalado.
    const faltan = close.diferencia;
    const muestrasNote =
      close.sampleUnits > 0
        ? ` (hay ${close.sampleUnits} muestra(s) registrada(s) — no se descuentan de lo producido, no compensan esta diferencia)`
        : "";
    throw new PlanningValidationError(
      faltan > 0
        ? `La distribución no coincide con la cantidad producida: faltan distribuir ${faltan} unidad(es) en cajas (embalado: ${close.packedUnits}, producido: ${params.finishedQty})${muestrasNote}. Indicá una observación si es una excepción justificada.`
        : `La distribución supera la cantidad producida por ${Math.abs(faltan)} unidad(es) (embalado: ${close.packedUnits}, producido: ${params.finishedQty}). Indicá una observación si es una excepción justificada.`
    );
  }
  return close;
}

/** Entrega DIRECTA desde Envasado: exige distribución de cajas y la valida (no hay excepción). */
export function assertEnvasadoDeliveryBoxes(params: {
  finishedQty: number | null | undefined;
  sampleUnits: number | null | undefined;
  packingGroups: unknown;
  observation: string | null | undefined;
}): ReturnType<typeof computePackagingClose> {
  if (!hasRealPackingGroups(params.packingGroups)) {
    throw new PlanningValidationError(
      "Para entregar desde Envasado cargá la distribución en cajas (cajas × unidades por caja). Si no tenés el desglose, enviá el trabajo a Codificado indicando solo la cantidad total."
    );
  }
  return assertPackagingCloseOrExplained(params);
}

export interface CodificadoTransferClose {
  /** Valor para work_items.deliverable_units, o undefined = no tocar. */
  deliverableUnits: number | null | undefined;
  /** true si hay una distribución real consistente y se puede registrar el cierre de packaging. */
  closed: boolean;
}

/**
 * Envasado → Codificado: SIN exigir cajas. Solo si trae una distribución real que coincide exactamente con el total
 * se registra el cierre; en cualquier otro caso no se valida ni se inventa nada.
 */
export function closeForCodificadoTransfer(params: {
  totalUnits: number | null | undefined;
  sampleUnits: number | null | undefined;
  packingGroups: unknown;
}): CodificadoTransferClose {
  if (!hasRealPackingGroups(params.packingGroups)) return { deliverableUnits: undefined, closed: false };
  const close = computePackagingClose({
    finishedQty: params.totalUnits,
    sampleUnits: params.sampleUnits,
    groups: normalizePackingGroups((params.packingGroups as RawGroups) ?? []),
  });
  if (close.canValidate && close.isValid) return { deliverableUnits: close.enCajas, closed: true };
  return { deliverableUnits: undefined, closed: false };
}
