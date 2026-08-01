import type { AuthSector, OsAuthSession } from "../contracts";
import {
  clearAuthSessionStorage,
  readAuthSessionFromStorage,
} from "./auth-session-storage";
import { genusAuthAdapter } from "../adapters/genus-auth-adapter";

/** Caché de presentación de la sesión; la cookie HttpOnly es la autoridad. */
export function getCurrentAuthSession(): OsAuthSession | null {
  return readAuthSessionFromStorage();
}

/** Elimina la caché de sesión de sessionStorage y localStorage. */
export function clearAuthSession(): void {
  clearAuthSessionStorage();
}

/** True cuando existe una caché de sesión contractual. */
export function isAuthenticatedPreview(): boolean {
  const session = getCurrentAuthSession();
  return session?.status === "preview" && session.mode === "preview";
}

/** Sector de la caché de sesión activa. */
export function getAuthSector(): AuthSector | null {
  return getCurrentAuthSession()?.sector ?? null;
}

/** Adapter de sesión real respaldado por la cookie HttpOnly. */
export { genusAuthAdapter };
/** @deprecated Use genusAuthAdapter. */
export { genusAuthAdapter as mockAuthAdapter };
