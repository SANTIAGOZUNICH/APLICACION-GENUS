import "server-only";

import { resolveAuthenticatedActor } from "@/lib/auth/resolve-authenticated-actor";
import { isSuperadminEmail, isSuperadminEmailConfigured } from "@/lib/auth/superadmin";
import { AuthNotFoundError, type AuthActor } from "@/lib/auth/types";

/**
 * Require authenticated superadmin. Always throws AuthNotFoundError (→ HTTP 404)
 * for unauthenticated or non-allowlisted actors — never 403 — to avoid leaking
 * that the admin surface exists.
 */
export async function requireSuperadminActor(request: Request): Promise<AuthActor> {
  if (!isSuperadminEmailConfigured()) {
    throw new AuthNotFoundError();
  }
  let actor: AuthActor;
  try {
    actor = await resolveAuthenticatedActor(request);
  } catch {
    throw new AuthNotFoundError();
  }
  if (!isSuperadminEmail(actor.email)) {
    throw new AuthNotFoundError();
  }
  return actor;
}
