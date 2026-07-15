import { findMockUserByEmail } from "@/features/os/auth/lib/mock-preview-users";
import type { PlanningActor } from "@/lib/planning/types";
import { PlanningForbiddenError, PlanningValidationError } from "@/lib/planning/types";

/** Headers enviados por el cliente desde la sesión mock resuelta (no campos libres del form). */
export const ACTOR_EMAIL_HEADER = "x-genus-actor-email";
export const ACTOR_SECTOR_HEADER = "x-genus-actor-sector";

export function resolvePlanningActor(request: Request): PlanningActor {
  const email = request.headers.get(ACTOR_EMAIL_HEADER)?.trim().toLowerCase();
  const claimedSector = request.headers.get(ACTOR_SECTOR_HEADER)?.trim().toUpperCase();

  if (!email) {
    throw new PlanningValidationError(
      "Sesión requerida (header x-genus-actor-email)."
    );
  }

  const user = findMockUserByEmail(email);
  if (!user) {
    throw new PlanningForbiddenError("Actor no reconocido en accesos demo.");
  }

  if (claimedSector && claimedSector !== user.sector) {
    throw new PlanningForbiddenError(
      "El sector de sesión no coincide con el usuario resuelto."
    );
  }

  return {
    email: user.email,
    sector: user.sector,
    displayName: user.displayName,
  };
}

export function assertProduccionActor(actor: PlanningActor): void {
  if (actor.sector !== "PRODUCCION" && actor.sector !== "DIRECCION") {
    throw new PlanningForbiddenError(
      "Solo Producción (o Dirección) puede modificar la planificación."
    );
  }
}
