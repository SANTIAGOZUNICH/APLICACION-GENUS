import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import { resolveAuthenticatedActor } from "@/lib/auth/resolve-authenticated-actor";
import { AuthUnauthorizedError, type AuthActor } from "@/lib/auth/types";
import type { PlanningActor } from "@/lib/planning/types";
import { PlanningForbiddenError, PlanningValidationError } from "@/lib/planning/types";

/**
 * Nombres de header históricos, definidos en un módulo client-safe
 * (@/lib/auth/header-names). IMPORTANTE: código de cliente debe
 * importarlos directamente desde `@/lib/auth/header-names`, nunca desde
 * este archivo — este módulo arrastra el árbol server-only de Genus Auth.
 *
 * En Preview real la identidad SIEMPRE viene de la cookie de sesión
 * (`genus_session`); estos headers quedan como fuente de identidad SOLO
 * en modo test (`NODE_ENV==='test'` o `GENUS_AUTH_ALLOW_TEST_HEADERS==='1'`).
 * Fuera de ese modo se IGNORAN.
 */
export { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER };

function toPlanningActor(actor: AuthActor): PlanningActor {
  return {
    email: actor.email,
    sector: actor.sector,
    displayName: actor.displayName,
  };
}

export async function resolvePlanningActor(request: Request): Promise<PlanningActor> {
  let actor: AuthActor;
  try {
    actor = await resolveAuthenticatedActor(request);
  } catch (err) {
    if (err instanceof AuthUnauthorizedError) {
      throw new PlanningValidationError("Sesión requerida (inicie sesión para continuar).");
    }
    throw err;
  }

  const claimedSector = request.headers.get(ACTOR_SECTOR_HEADER)?.trim().toUpperCase();
  if (claimedSector && claimedSector !== actor.sector) {
    throw new PlanningForbiddenError(
      "El sector de sesión no coincide con el usuario resuelto."
    );
  }

  return toPlanningActor(actor);
}

export function assertProduccionActor(actor: PlanningActor): void {
  if (actor.sector !== "PRODUCCION" && actor.sector !== "DIRECCION") {
    throw new PlanningForbiddenError(
      "Solo Producción (o Dirección) puede modificar la planificación."
    );
  }
}
