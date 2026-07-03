import { GENUS_COMPANY_NAME } from "../constants";
import type { AuthAdapter, AuthCredentials, OsAuthSession } from "../contracts";
import {
  clearAuthSessionStorage,
  readAuthSessionFromStorage,
  writeAuthSessionToStorage,
} from "../lib/auth-session-storage";
import {
  validateMockPreviewCredentials,
  type MockPreviewUser,
} from "../lib/mock-preview-users";
import type { SectorId } from "@/types/operational/sector";

function mapMockUserToSession(user: MockPreviewUser, rememberMe: boolean): OsAuthSession {
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

/**
 * @mock-temp Implementación preview — credenciales internas sin auth real.
 * Reemplazar por adapter real en PR 4.4+.
 */
export class MockAuthAdapter implements AuthAdapter {
  async signIn(credentials: AuthCredentials): Promise<OsAuthSession | null> {
    const user = validateMockPreviewCredentials(credentials.email, credentials.password);
    if (!user) return null;

    const session = mapMockUserToSession(user, credentials.rememberMe);
    writeAuthSessionToStorage(session);
    return session;
  }

  async signOut(): Promise<void> {
    clearAuthSessionStorage();
  }

  getSession(): OsAuthSession | null {
    return readAuthSessionFromStorage();
  }
}

export const mockAuthAdapter = new MockAuthAdapter();

export { mapMockUserToSession };
