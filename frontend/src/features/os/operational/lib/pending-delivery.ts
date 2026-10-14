import type { QualityItem } from "../types";

/**
 * ¿El trabajo terminado está listo para registrar su entrega? (circuito sin Calidad)
 *
 * Fuente de verdad: `operationalStatus === "revision"` (terminado, sin entrega completa). Para fuentes legadas que
 * no informan el estado operativo (trabajos no nativos) se conserva el criterio histórico: la decisión «aprobado»
 * de Calidad, que ya no se genera pero se sigue leyendo.
 */
export function isReadyForDelivery(item: Pick<QualityItem, "operationalStatus" | "status">): boolean {
  if (item.operationalStatus != null) return item.operationalStatus === "revision";
  return item.status === "aprobado";
}
