/**
 * RBAC — solo PRODUCCION puede eliminar o cancelar trabajos asignados.
 * actorSectorId es obligatorio; no es autenticación server-side completa.
 */

import type { SectorId } from "@/types/operational/sector";

export const WORK_MUTATION_DENIED_MESSAGE =
  "Solo Producción puede eliminar o cancelar trabajos asignados.";

export const WORK_MUTATION_MISSING_ACTOR_MESSAGE =
  "Falta actorSectorId. Las acciones sobre trabajos requieren sector PRODUCCION.";

export type WorkMutationAttempt =
  | { ok: true }
  | {
      ok: false;
      error: string;
      code: "WORK_MUTATION_FORBIDDEN" | "WORK_MUTATION_MISSING_ACTOR";
    };

export function canMutateAssignedWork(sectorId: SectorId | null | undefined): boolean {
  return sectorId === "PRODUCCION";
}

export function gateWorkMutation(
  actorSectorId: SectorId | null | undefined
): WorkMutationAttempt {
  if (actorSectorId == null || actorSectorId === ("" as SectorId)) {
    return {
      ok: false,
      error: WORK_MUTATION_MISSING_ACTOR_MESSAGE,
      code: "WORK_MUTATION_MISSING_ACTOR",
    };
  }
  if (actorSectorId !== "PRODUCCION") {
    return {
      ok: false,
      error: WORK_MUTATION_DENIED_MESSAGE,
      code: "WORK_MUTATION_FORBIDDEN",
    };
  }
  return { ok: true };
}

export function validateWorkMutationActor(actorSectorId: unknown): WorkMutationAttempt {
  if (typeof actorSectorId !== "string" || actorSectorId.trim() === "") {
    return {
      ok: false,
      error: WORK_MUTATION_MISSING_ACTOR_MESSAGE,
      code: "WORK_MUTATION_MISSING_ACTOR",
    };
  }
  return gateWorkMutation(actorSectorId as SectorId);
}
