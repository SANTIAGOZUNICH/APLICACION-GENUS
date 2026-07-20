/**
 * RBAC de decisión de Calidad — también usable desde el route handler.
 * actorSectorId es obligatorio y debe ser exactamente "CALIDAD".
 *
 * Esto NO es autenticación server-side: el cliente aún podría falsificar
 * actorSectorId. Es una defensa de acción en el pipeline mientras Identity
 * Access autenticado no exista (docss/29-identity-access.md).
 */

import type { SectorId } from "@/types/operational/sector";

export const QUALITY_DECISION_DENIED_MESSAGE =
  "Solo el sector Calidad puede aprobar o rechazar. Tu sesión no tiene permiso para decidir.";

export const QUALITY_DECISION_MISSING_ACTOR_MESSAGE =
  "Falta actorSectorId. Las decisiones de Calidad requieren sector autenticado CALIDAD.";

export type QualityDecisionActorSector = SectorId | "" | null | undefined;

export function canDecideQuality(sectorId: QualityDecisionActorSector): boolean {
  return sectorId === "CALIDAD";
}

export function assertCanDecideQuality(sectorId: QualityDecisionActorSector): void {
  if (!canDecideQuality(sectorId)) {
    throw new Error(
      sectorId == null || sectorId === ""
        ? QUALITY_DECISION_MISSING_ACTOR_MESSAGE
        : QUALITY_DECISION_DENIED_MESSAGE
    );
  }
}

export type QualityDecisionAttempt =
  | { ok: true }
  | { ok: false; error: string; code: "QUALITY_DECISION_FORBIDDEN" | "QUALITY_DECISION_MISSING_ACTOR" };

/** Valida el sector actor antes de persistir o enviar una decisión. */
export function gateQualityDecision(
  actorSectorId: QualityDecisionActorSector
): QualityDecisionAttempt {
  if (actorSectorId == null || actorSectorId === "") {
    return {
      ok: false,
      error: QUALITY_DECISION_MISSING_ACTOR_MESSAGE,
      code: "QUALITY_DECISION_MISSING_ACTOR",
    };
  }
  if (actorSectorId !== "CALIDAD") {
    return {
      ok: false,
      error: QUALITY_DECISION_DENIED_MESSAGE,
      code: "QUALITY_DECISION_FORBIDDEN",
    };
  }
  return { ok: true };
}

/** Validación estricta para el endpoint Live Sync (actorSectorId obligatorio). */
export function validateQualityDecisionActor(
  actorSectorId: unknown
): QualityDecisionAttempt {
  if (typeof actorSectorId !== "string" || actorSectorId.trim() === "") {
    return {
      ok: false,
      error: QUALITY_DECISION_MISSING_ACTOR_MESSAGE,
      code: "QUALITY_DECISION_MISSING_ACTOR",
    };
  }
  return gateQualityDecision(actorSectorId as SectorId);
}
