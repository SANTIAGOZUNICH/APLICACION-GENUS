import type { AuthCredentials, OsAuthSession } from "./types";

/**
 * Contrato de autenticación — implementaciones mock (4.2) y real (4.4+).
 * Login resuelve identidad; Role Engine resuelve experiencia sectorial.
 */
export interface AuthAdapter {
  signIn(credentials: AuthCredentials): Promise<OsAuthSession | null>;
  signOut(): Promise<void>;
  getSession(): OsAuthSession | null;
}
