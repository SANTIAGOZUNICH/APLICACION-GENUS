/**
 * "Rehacer" — Calidad o Producción devuelve un work item al sector que lo
 * envió, editable, conservando identidad/OA/lote/VTO/historial. Distinto de
 * "Rechazar" (decisión formal de Calidad, ver decideQualityDurable) y
 * distinto de crear un trabajo nuevo. Predicado puro compartido por servidor
 * (reworkWorkItemDurable) y UI (habilitación optimista del botón) — mismo
 * patrón que canReopenCodificadoDelivery en codificado-flow.ts, pero
 * genérico: aplica a los 4 sectores que gestiona Producción, no solo a la
 * entrega Codificado→Calidad.
 */

export type ReworkEligibilityCode =
  | "NOT_COMPLETED"
  | "QUALITY_DECIDED"
  | "ALREADY_DELIVERED_TO_CLIENT";

export type ReworkEligibility =
  | { ok: true }
  | { ok: false; code: ReworkEligibilityCode; error: string };

export interface ReworkEligibilityInput {
  /** null/undefined = el trabajo nunca se completó/envió — nada que rehacer. */
  completedAt?: string | null;
  qualityStatus?: string | null;
  /** true si existe una entrega comercial real (work_item_deliveries ENTREGADO, no archivada). */
  hasActiveClientDelivery?: boolean;
}

/**
 * ¿Se puede pedir Rehacer sobre este work item ahora?
 * Orden de chequeo: primero "hay algo para rehacer" (completedAt), después
 * "Calidad no tomó ya una decisión formal" (qualityStatus), por último "no
 * hay un hecho comercial irreversible" (entrega real al cliente).
 */
export function canRequestRework(input: ReworkEligibilityInput): ReworkEligibility {
  if (!input.completedAt) {
    return {
      ok: false,
      code: "NOT_COMPLETED",
      error: "Este trabajo todavía no fue completado ni enviado — no hay nada que rehacer.",
    };
  }
  if (input.qualityStatus && input.qualityStatus !== "pendiente") {
    return {
      ok: false,
      code: "QUALITY_DECIDED",
      error:
        "Calidad ya tomó una decisión sobre este trabajo. Anulá la decisión antes de pedir Rehacer.",
    };
  }
  if (input.hasActiveClientDelivery) {
    return {
      ok: false,
      code: "ALREADY_DELIVERED_TO_CLIENT",
      error: "Este trabajo ya fue entregado al cliente — no se puede rehacer.",
    };
  }
  return { ok: true };
}
