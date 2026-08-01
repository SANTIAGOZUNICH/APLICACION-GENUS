import "server-only";

import { ACTOR_EMAIL_HEADER } from "@/lib/auth/constants";
import { parseSessionCookie } from "@/lib/auth/cookies";
import { findDirectoryEntryByEmail, normalizeEmail } from "@/lib/auth/directory";
import { getAuthService } from "@/lib/auth/get-auth-service";
import { AuthUnauthorizedError, type AuthActor } from "@/lib/auth/types";

/** Directorio → AuthActor "provisional" (solo para el header legacy de tests). No trae userId real. */
const TEST_HEADER_ACTOR_USER_ID_PREFIX = "test-header:";

function isTestHeaderModeEnabled(): boolean {
  return (
    process.env.NODE_ENV === "test" || process.env.GENUS_AUTH_ALLOW_TEST_HEADERS === "1"
  );
}

/**
 * Resuelve la identidad autenticada de un request.
 *
 * Orden de resolución:
 * 1. Cookie `genus_session` (HttpOnly) → valida contra AuthService.
 * 2. Si NO hay cookie válida y estamos en modo test
 *    (`NODE_ENV==='test'` o `GENUS_AUTH_ALLOW_TEST_HEADERS==='1'`): se
 *    acepta el header legacy `x-genus-actor-email` resuelto contra el
 *    directorio de cuentas (SOLO para compatibilidad con vitest/harness
 *    de tests — nunca se usa como fuente de identidad en Preview real).
 * 3. En cualquier otro caso: `AuthUnauthorizedError` (401). El header NUNCA
 *    es fuente de identidad fuera de modo test, aunque esté presente.
 *
 * El body del request nunca se usa para identidad (sector/email en el
 * body son datos de negocio, no autenticación).
 */
export async function resolveAuthenticatedActor(request: Request): Promise<AuthActor> {
  const cookieHeader = request.headers.get("cookie");
  const token = parseSessionCookie(cookieHeader);

  if (token) {
    const actor = await getAuthService().resolveSession(token);
    if (actor) return actor;
  }

  if (isTestHeaderModeEnabled()) {
    const headerEmail = request.headers.get(ACTOR_EMAIL_HEADER)?.trim();
    if (headerEmail) {
      const entry = findDirectoryEntryByEmail(headerEmail);
      if (entry) {
        return {
          userId: `${TEST_HEADER_ACTOR_USER_ID_PREFIX}${normalizeEmail(entry.email)}`,
          email: entry.email,
          sector: entry.sector,
          displayName: entry.displayName,
          roleId: entry.role,
          roleLabel: entry.roleLabel,
          sectorLabel: entry.sectorLabel,
          jobTitle: entry.jobTitle,
          redirectTo: entry.redirectTo,
        };
      }
    }
  }

  throw new AuthUnauthorizedError();
}
