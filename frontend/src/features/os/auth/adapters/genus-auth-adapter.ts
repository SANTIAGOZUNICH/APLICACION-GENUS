import { GENUS_COMPANY_NAME } from "../constants";
import type { AuthAdapter, AuthCredentials, OsAuthSession } from "../contracts";
import {
  clearAuthSessionStorage,
  readAuthSessionFromStorage,
  writeAuthSessionToStorage,
} from "../lib/auth-session-storage";
import type { SectorId } from "@/types/operational/sector";

interface AuthenticatedUser {
  email: string;
  displayName: string;
  sector: string;
  role: string;
  roleLabel: string;
  sectorLabel: string;
  jobTitle: string;
  redirectTo: string;
}

interface AuthResponse {
  user?: AuthenticatedUser;
  error?: string;
  message?: string;
}

export class AuthAdapterError extends Error {}

export function mapAuthenticatedUserToSession(
  user: AuthenticatedUser,
  rememberMe: boolean
): OsAuthSession {
  return {
    status: "preview",
    mode: "preview",
    user: {
      email: user.email,
      displayName: user.displayName,
      jobTitle: user.jobTitle,
      company: GENUS_COMPANY_NAME,
    },
    sector: {
      id: user.sector as SectorId,
      label: user.sectorLabel,
    },
    role: {
      id: user.role,
      label: user.roleLabel,
    },
    rememberMe,
    redirectTo: user.redirectTo,
    createdAt: new Date().toISOString(),
  };
}

function isAuthenticatedUser(value: AuthResponse["user"]): value is AuthenticatedUser {
  return Boolean(
    value &&
      typeof value.email === "string" &&
      typeof value.displayName === "string" &&
      typeof value.sector === "string" &&
      typeof value.role === "string" &&
      typeof value.roleLabel === "string" &&
      typeof value.sectorLabel === "string" &&
      typeof value.jobTitle === "string" &&
      typeof value.redirectTo === "string"
  );
}

async function readResponse(response: Response): Promise<AuthResponse> {
  return (await response.json().catch(() => ({}))) as AuthResponse;
}

/** Browser adapter backed by the HttpOnly Genus Auth session cookie. */
export class GenusAuthAdapter implements AuthAdapter {
  async signIn(credentials: AuthCredentials): Promise<OsAuthSession | null> {
    const response = await fetch("/api/v1/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: credentials.email,
        password: credentials.password,
        rememberMe: credentials.rememberMe,
      }),
    });
    const payload = await readResponse(response);

    if (!response.ok || !isAuthenticatedUser(payload.user)) {
      if (response.status === 403 || response.status === 429 || response.status >= 500) {
        throw new AuthAdapterError(
          payload.error || payload.message || "No pudimos iniciar sesión. Intentá nuevamente."
        );
      }
      return null;
    }

    const session = mapAuthenticatedUserToSession(payload.user, credentials.rememberMe);
    writeAuthSessionToStorage(session);
    return session;
  }

  async signOut(): Promise<void> {
    try {
      await fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" });
    } finally {
      clearAuthSessionStorage();
    }
  }

  getSession(): OsAuthSession | null {
    return readAuthSessionFromStorage();
  }

  async hydrateSession(rememberMe = this.getSession()?.rememberMe ?? false): Promise<OsAuthSession | null> {
    const response = await fetch("/api/v1/auth/me", { credentials: "include" });
    if (response.status === 401) {
      clearAuthSessionStorage();
      return null;
    }

    const payload = await readResponse(response);
    if (!response.ok || !isAuthenticatedUser(payload.user)) {
      throw new AuthAdapterError(payload.message || "No pudimos verificar la sesión.");
    }

    const session = mapAuthenticatedUserToSession(payload.user, rememberMe);
    writeAuthSessionToStorage(session);
    return session;
  }
}

export const genusAuthAdapter = new GenusAuthAdapter();
