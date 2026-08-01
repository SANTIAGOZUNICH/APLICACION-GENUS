import { randomUUID } from "node:crypto";
import type { AuthRepository } from "@/lib/auth/repository";
import type { AuthAuditEvent, AuthEventType, AuthSession, AuthUser } from "@/lib/auth/types";

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Repositorio en memoria de proceso — usado por defecto en Preview hasta
 * que la migración 0016 esté aplicada, y siempre en tests unitarios. No es
 * durable: no sobrevive reinicios ni se comparte entre instancias/regiones.
 */
export class MemoryAuthRepository implements AuthRepository {
  private readonly usersById = new Map<string, AuthUser>();
  private readonly usersByEmailNormalized = new Map<string, string>();
  private readonly sessionsById = new Map<string, AuthSession>();
  private readonly sessionsByTokenHash = new Map<string, string>();
  private readonly auditEvents: AuthAuditEvent[] = [];

  async findUserByEmailNormalized(emailNormalized: string): Promise<AuthUser | null> {
    const id = this.usersByEmailNormalized.get(emailNormalized);
    if (!id) return null;
    return this.usersById.get(id) ?? null;
  }

  async getUserById(id: string): Promise<AuthUser | null> {
    return this.usersById.get(id) ?? null;
  }

  async insertUser(user: AuthUser): Promise<AuthUser> {
    this.usersById.set(user.id, user);
    this.usersByEmailNormalized.set(user.emailNormalized, user.id);
    return user;
  }

  async updateUser(id: string, patch: Partial<AuthUser>): Promise<AuthUser | null> {
    const current = this.usersById.get(id);
    if (!current) return null;
    const updated: AuthUser = { ...current, ...patch, id: current.id };
    this.usersById.set(id, updated);
    if (patch.emailNormalized && patch.emailNormalized !== current.emailNormalized) {
      this.usersByEmailNormalized.delete(current.emailNormalized);
      this.usersByEmailNormalized.set(updated.emailNormalized, id);
    }
    return updated;
  }

  async listUsers(): Promise<AuthUser[]> {
    return Array.from(this.usersById.values());
  }

  async insertSession(session: AuthSession): Promise<AuthSession> {
    this.sessionsById.set(session.id, session);
    this.sessionsByTokenHash.set(session.tokenHash, session.id);
    return session;
  }

  async findSessionByTokenHash(tokenHash: string): Promise<AuthSession | null> {
    const id = this.sessionsByTokenHash.get(tokenHash);
    if (!id) return null;
    return this.sessionsById.get(id) ?? null;
  }

  async revokeSession(id: string, revokedAt: string): Promise<void> {
    const current = this.sessionsById.get(id);
    if (!current) return;
    this.sessionsById.set(id, { ...current, revokedAt });
  }

  async insertAuditEvent(
    event: Omit<AuthAuditEvent, "id" | "createdAt"> & { id?: string; createdAt?: string }
  ): Promise<AuthAuditEvent> {
    const record: AuthAuditEvent = {
      id: event.id ?? randomUUID(),
      eventType: event.eventType,
      emailNormalized: event.emailNormalized,
      userId: event.userId,
      detail: event.detail,
      createdAt: event.createdAt ?? nowIso(),
    };
    this.auditEvents.push(record);
    return record;
  }

  async listAuditEvents(filter?: {
    eventType?: AuthEventType;
    emailNormalized?: string;
  }): Promise<AuthAuditEvent[]> {
    return this.auditEvents.filter((event) => {
      if (filter?.eventType && event.eventType !== filter.eventType) return false;
      if (filter?.emailNormalized && event.emailNormalized !== filter.emailNormalized) return false;
      return true;
    });
  }

  /** Solo tests: limpia todo el estado en memoria. */
  reset(): void {
    this.usersById.clear();
    this.usersByEmailNormalized.clear();
    this.sessionsById.clear();
    this.sessionsByTokenHash.clear();
    this.auditEvents.length = 0;
  }
}
