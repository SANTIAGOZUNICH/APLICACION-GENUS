/**
 * RBAC de entregas — solo PRODUCCION puede mutar.
 * actorSectorId obligatorio; no es auth server-side completa.
 */

import type { SectorId } from "@/types/operational/sector";

export const DELIVERY_MUTATION_DENIED_MESSAGE =
  "Solo Producción puede confirmar, archivar, anular o eliminar entregas.";

export const DELIVERY_MUTATION_MISSING_ACTOR_MESSAGE =
  "Falta actorSectorId. Las acciones de entrega requieren sector PRODUCCION.";

export type DeliveryMutationAttempt =
  | { ok: true }
  | {
      ok: false;
      error: string;
      code: "DELIVERY_MUTATION_FORBIDDEN" | "DELIVERY_MUTATION_MISSING_ACTOR";
    };

export function canMutateDeliveries(sectorId: SectorId | null | undefined): boolean {
  return sectorId === "PRODUCCION";
}

export function canViewDeliveries(sectorId: SectorId | null | undefined): boolean {
  return (
    sectorId === "PRODUCCION" ||
    sectorId === "CALIDAD" ||
    sectorId === "DIRECCION" ||
    sectorId === "ELABORACION" ||
    sectorId === "ENVASADO_MASIVO" ||
    sectorId === "ENVASADO_PREMIUM"
  );
}

export function gateDeliveryMutation(
  actorSectorId: SectorId | null | undefined
): DeliveryMutationAttempt {
  if (actorSectorId == null || actorSectorId === ("" as SectorId)) {
    return {
      ok: false,
      error: DELIVERY_MUTATION_MISSING_ACTOR_MESSAGE,
      code: "DELIVERY_MUTATION_MISSING_ACTOR",
    };
  }
  if (actorSectorId !== "PRODUCCION") {
    return {
      ok: false,
      error: DELIVERY_MUTATION_DENIED_MESSAGE,
      code: "DELIVERY_MUTATION_FORBIDDEN",
    };
  }
  return { ok: true };
}

export function validateDeliveryMutationActor(actorSectorId: unknown): DeliveryMutationAttempt {
  if (typeof actorSectorId !== "string" || actorSectorId.trim() === "") {
    return {
      ok: false,
      error: DELIVERY_MUTATION_MISSING_ACTOR_MESSAGE,
      code: "DELIVERY_MUTATION_MISSING_ACTOR",
    };
  }
  return gateDeliveryMutation(actorSectorId as SectorId);
}
