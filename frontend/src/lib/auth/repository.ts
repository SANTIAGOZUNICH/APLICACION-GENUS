import type { AuthAuditEvent, AuthEventType, AuthSession, AuthUser } from "@/lib/auth/types";

/**
 * Contrato de persistencia de Genus Auth. `MemoryAuthRepository` es la única
 * implementación disponible hasta que se aplique la migración 0016
 * (`APPLY_MIGRATION_0016=1`) y se conecte `DrizzleAuthRepository` sobre Neon
 * (`GENUS_AUTH_BACKEND=neon`).
 */
export interface AuthRepository {
  findUserByEmailNormalized(emailNormalized: string): Promise<AuthUser | null>;
  getUserById(id: string): Promise<AuthUser | null>;
  insertUser(user: AuthUser): Promise<AuthUser>;
  updateUser(id: string, patch: Partial<AuthUser>): Promise<AuthUser | null>;
  listUsers(): Promise<AuthUser[]>;

  insertSession(session: AuthSession): Promise<AuthSession>;
  findSessionByTokenHash(tokenHash: string): Promise<AuthSession | null>;
  revokeSession(id: string, revokedAt: string): Promise<void>;

  insertAuditEvent(
    event: Omit<AuthAuditEvent, "id" | "createdAt"> & { id?: string; createdAt?: string }
  ): Promise<AuthAuditEvent>;
  listAuditEvents(filter?: { eventType?: AuthEventType; emailNormalized?: string }): Promise<AuthAuditEvent[]>;
}
