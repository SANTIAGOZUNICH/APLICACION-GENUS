import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import { resolveAuthenticatedActor } from "@/lib/auth/resolve-authenticated-actor";
import { AuthUnauthorizedError, type AuthActor } from "@/lib/auth/types";
import type { OrdersActor } from "@/lib/orders/types";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import type { SectorId } from "@/types/operational/sector";
import { OPERATIONAL_SECTOR_IDS } from "@/types/operational/sector";

/**
 * Nombres de header históricos, definidos en un módulo client-safe
 * (@/lib/auth/header-names). IMPORTANTE: código de cliente que solo
 * necesita estos nombres (para armar headers de fetch) debe importarlos
 * directamente desde `@/lib/auth/header-names`, NUNCA desde este archivo
 * — este módulo arrastra el árbol server-only de Genus Auth
 * (resolveAuthenticatedActor → bcryptjs/node:crypto/drizzle) y no puede
 * bundlearse en un Client Component.
 *
 * En Preview real la identidad SIEMPRE viene de la cookie de sesión
 * (`genus_session`); estos headers quedan como fuente de identidad SOLO
 * en modo test (`NODE_ENV==='test'` o `GENUS_AUTH_ALLOW_TEST_HEADERS==='1'`).
 * Fuera de ese modo, el runtime los IGNORA por completo.
 */
export { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER };

function isSectorId(value: string): value is SectorId {
  return (OPERATIONAL_SECTOR_IDS as readonly string[]).includes(value);
}

function toOrdersActor(actor: AuthActor): OrdersActor {
  if (!isSectorId(actor.sector)) {
    throw new OrdersForbiddenError("Sector de actor inválido.");
  }
  return {
    userId: actor.userId,
    email: actor.email,
    sector: actor.sector,
    displayName: actor.displayName,
    sectorLabel: actor.sectorLabel,
    jobTitle: actor.jobTitle,
    roleId: actor.roleId,
    roleLabel: actor.roleLabel,
  };
}

export async function resolveOrdersActor(request: Request): Promise<OrdersActor> {
  let actor: AuthActor;
  try {
    actor = await resolveAuthenticatedActor(request);
  } catch (err) {
    if (err instanceof AuthUnauthorizedError) {
      throw new OrdersValidationError("Sesión requerida (inicie sesión para continuar).");
    }
    throw err;
  }

  const claimedSector = request.headers.get(ACTOR_SECTOR_HEADER)?.trim().toUpperCase();
  if (claimedSector && claimedSector !== actor.sector) {
    throw new OrdersForbiddenError(
      "El sector de sesión no coincide con el usuario resuelto."
    );
  }

  return toOrdersActor(actor);
}
