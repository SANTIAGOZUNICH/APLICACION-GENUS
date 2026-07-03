import type { AuthSector, OsAuthSession } from "../contracts";
import {
  clearAuthSessionStorage,
  readAuthSessionFromStorage,
} from "./auth-session-storage";
import { mockAuthAdapter } from "../adapters/mock-auth-adapter";

/** Sesión preview activa, o null si no hay identidad persistida. */
export function getCurrentAuthSession(): OsAuthSession | null {
  return readAuthSessionFromStorage();
}

/** Elimina sesión preview de sessionStorage y localStorage. */
export function clearAuthSession(): void {
  clearAuthSessionStorage();
}

/** True cuando existe sesión contractual en modo preview. */
export function isAuthenticatedPreview(): boolean {
  const session = getCurrentAuthSession();
  return session?.status === "preview" && session.mode === "preview";
}

/** Sector de la sesión preview activa. */
export function getAuthSector(): AuthSector | null {
  return getCurrentAuthSession()?.sector ?? null;
}

/** Adapter preview por defecto — punto único para PR 4.4+. */
export { mockAuthAdapter };
