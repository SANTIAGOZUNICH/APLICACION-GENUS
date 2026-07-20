import type { SectorId } from "@/types/operational/sector";

/**
 * Regla de acción de Calidad (cliente / action pipeline):
 * Solo una sesión cuyo sectorId sea CALIDAD puede aprobar, rechazar
 * o guardar decisiones de Calidad. Otros sectores (p. ej. Producción)
 * pueden consultar pendientes/aprobados/rechazados en solo lectura.
 *
 * No reemplaza un RBAC server-side completo — es defensa efectiva en
 * el pipeline de acciones del cliente mientras Identity Access sigue
 * documentado como trabajo futuro (docss/29-identity-access.md).
 */

export const QUALITY_DECISION_DENIED_MESSAGE =
  "Solo el sector Calidad puede aprobar o rechazar. Tu sesión no tiene permiso para decidir.";

export function canDecideQuality(sectorId: SectorId | null | undefined): boolean {
  return sectorId === "CALIDAD";
}

export function assertCanDecideQuality(sectorId: SectorId | null | undefined): void {
  if (!canDecideQuality(sectorId)) {
    throw new Error(QUALITY_DECISION_DENIED_MESSAGE);
  }
}

export type QualityDecisionAttempt =
  | { ok: true }
  | { ok: false; error: string };

/** Valida el sector actor antes de persistir o enviar una decisión. */
export function gateQualityDecision(
  actorSectorId: SectorId | null | undefined
): QualityDecisionAttempt {
  if (!canDecideQuality(actorSectorId)) {
    return { ok: false, error: QUALITY_DECISION_DENIED_MESSAGE };
  }
  return { ok: true };
}
