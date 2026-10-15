/**
 * "Rehacer" — Producción/Dirección devuelven un work item al sector que lo
 * tiene, editable, conservando identidad/OA/lote/VTO/historial. Distinto de
 * crear un trabajo nuevo. Circuito sin Calidad: ya NO depende de ninguna
 * decisión de Calidad (las decisiones históricas se conservan pero no
 * bloquean). Predicado puro compartido por servidor (reworkWorkItemDurable) y
 * UI (habilitación optimista del botón).
 */

export type ReworkEligibilityCode = "NOT_COMPLETED" | "ALREADY_DELIVERED_TO_CLIENT";

export type ReworkEligibility =
  | { ok: true }
  | { ok: false; code: ReworkEligibilityCode; error: string };

export interface ReworkEligibilityInput {
  /** null/undefined = el trabajo nunca se completó/envió — nada que rehacer. */
  completedAt?: string | null;
  /** @deprecated Ignorado: las decisiones históricas de Calidad ya no bloquean el Rehacer. */
  qualityStatus?: string | null;
  /** true si existe una entrega comercial real (work_item_deliveries ENTREGADO, no archivada). */
  hasActiveClientDelivery?: boolean;
}

/**
 * ¿Se puede pedir Rehacer sobre este work item ahora?
 * Orden de chequeo: primero "hay algo para rehacer" (completedAt), después
 * "no hay un hecho comercial irreversible" (entrega registrada al cliente).
 */
export function canRequestRework(input: ReworkEligibilityInput): ReworkEligibility {
  if (!input.completedAt) {
    return {
      ok: false,
      code: "NOT_COMPLETED",
      error: "Este trabajo todavía no fue completado ni enviado — no hay nada que rehacer.",
    };
  }
  if (input.hasActiveClientDelivery) {
    return {
      ok: false,
      code: "ALREADY_DELIVERED_TO_CLIENT",
      error: "Este trabajo ya tiene entregas registradas — anulá la entrega antes de rehacerlo.",
    };
  }
  return { ok: true };
}
