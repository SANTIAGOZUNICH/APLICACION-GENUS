/**
 * Hook post-aprobación Calidad.
 *
 * IMPORTANTE: ya NO crea remitos automáticamente.
 * Aprobar solo deja el trabajo “apto para remito”.
 * El borrador / versión / Blob se crean únicamente cuando Producción
 * confirma en el editor (Guardar borrador o Generar Excel).
 */
export async function softUpsertRemitoFromQualityApproval(_params: {
  itemId: string;
  status: "aprobado" | "rechazado";
  actorEmail?: string;
  actorSector?: string;
}): Promise<void> {
  // No-op a propósito: evitar side-effects en quality_decision.
  return;
}
