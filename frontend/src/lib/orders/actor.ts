import { findMockUserByEmail } from "@/features/os/auth/lib/mock-preview-users";
import type { OrdersActor } from "@/lib/orders/types";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import type { SectorId } from "@/types/operational/sector";
import { OPERATIONAL_SECTOR_IDS } from "@/types/operational/sector";

export const ACTOR_EMAIL_HEADER = "x-genus-actor-email";
export const ACTOR_SECTOR_HEADER = "x-genus-actor-sector";

function isSectorId(value: string): value is SectorId {
  return (OPERATIONAL_SECTOR_IDS as readonly string[]).includes(value);
}

export function resolveOrdersActor(request: Request): OrdersActor {
  const email = request.headers.get(ACTOR_EMAIL_HEADER)?.trim().toLowerCase();
  const claimedSector = request.headers.get(ACTOR_SECTOR_HEADER)?.trim().toUpperCase();

  if (!email) {
    throw new OrdersValidationError(
      "Sesión requerida (header x-genus-actor-email)."
    );
  }

  const user = findMockUserByEmail(email);
  if (!user) {
    throw new OrdersForbiddenError("Actor no reconocido en accesos demo.");
  }

  if (claimedSector && claimedSector !== user.sector) {
    throw new OrdersForbiddenError(
      "El sector de sesión no coincide con el usuario resuelto."
    );
  }

  if (!isSectorId(user.sector)) {
    throw new OrdersForbiddenError("Sector de actor inválido.");
  }

  return {
    email: user.email,
    sector: user.sector,
    displayName: user.displayName,
  };
}
