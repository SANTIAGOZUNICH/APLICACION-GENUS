import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import type { AuthRepository } from "@/lib/auth/repository";
import {
  genusAuthAuditEvents,
  genusAuthSessions,
  genusAuthUsers,
  type GenusAuthUserRow,
} from "@/lib/auth/schema";
import type { AuthAuditEvent, AuthEventType, AuthSession, AuthUser, AuthUserStatus } from "@/lib/auth/types";

function mapUser(row: GenusAuthUserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    emailNormalized: row.emailNormalized,
    displayName: row.displayName,
    sector: row.sector,
    roleId: row.roleId,
    roleLabel: row.roleLabel,
    sectorLabel: row.sectorLabel,
    jobTitle: row.jobTitle,
    status: row.status as AuthUserStatus,
    passwordHash: row.passwordHash,
    redirectTo: row.redirectTo,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
  };
}

/**
 * Repositorio Drizzle sobre Neon — solo se usa cuando GENUS_AUTH_BACKEND=neon
 * y la migración 0016 (drizzle/0016_genus_auth.sql) fue aplicada
 * (APPLY_MIGRATION_0016=1). Ver src/lib/auth/get-auth-service.ts.
 */
export class DrizzleAuthRepository implements AuthRepository {
  async findUserByEmailNormalized(emailNormalized: string): Promise<AuthUser | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(genusAuthUsers)
      .where(eq(genusAuthUsers.emailNormalized, emailNormalized))
      .limit(1);
    return rows[0] ? mapUser(rows[0]) : null;
  }

  async getUserById(id: string): Promise<AuthUser | null> {
    const db = getDb();
    const rows = await db.select().from(genusAuthUsers).where(eq(genusAuthUsers.id, id)).limit(1);
    return rows[0] ? mapUser(rows[0]) : null;
  }

  async insertUser(user: AuthUser): Promise<AuthUser> {
    const db = getDb();
    await db.insert(genusAuthUsers).values({
      id: user.id,
      email: user.email,
      emailNormalized: user.emailNormalized,
      displayName: user.displayName,
      sector: user.sector,
      roleId: user.roleId,
      roleLabel: user.roleLabel,
      sectorLabel: user.sectorLabel,
      jobTitle: user.jobTitle,
      status: user.status,
      passwordHash: user.passwordHash,
      redirectTo: user.redirectTo,
      createdAt: new Date(user.createdAt),
      updatedAt: new Date(user.updatedAt),
      lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt) : null,
    });
    return user;
  }

  async updateUser(id: string, patch: Partial<AuthUser>): Promise<AuthUser | null> {
    const db = getDb();
    const values: Record<string, unknown> = {};
    if (patch.email !== undefined) values.email = patch.email;
    if (patch.emailNormalized !== undefined) values.emailNormalized = patch.emailNormalized;
    if (patch.displayName !== undefined) values.displayName = patch.displayName;
    if (patch.sector !== undefined) values.sector = patch.sector;
    if (patch.roleId !== undefined) values.roleId = patch.roleId;
    if (patch.roleLabel !== undefined) values.roleLabel = patch.roleLabel;
    if (patch.sectorLabel !== undefined) values.sectorLabel = patch.sectorLabel;
    if (patch.jobTitle !== undefined) values.jobTitle = patch.jobTitle;
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.passwordHash !== undefined) values.passwordHash = patch.passwordHash;
    if (patch.redirectTo !== undefined) values.redirectTo = patch.redirectTo;
    if (patch.updatedAt !== undefined) values.updatedAt = new Date(patch.updatedAt);
    if (patch.lastLoginAt !== undefined) {
      values.lastLoginAt = patch.lastLoginAt ? new Date(patch.lastLoginAt) : null;
    }
    if (Object.keys(values).length === 0) return this.getUserById(id);
    await db.update(genusAuthUsers).set(values).where(eq(genusAuthUsers.id, id));
    return this.getUserById(id);
  }

  async listUsers(): Promise<AuthUser[]> {
    const db = getDb();
    const rows = await db.select().from(genusAuthUsers);
    return rows.map(mapUser);
  }

  async insertSession(session: AuthSession): Promise<AuthSession> {
    const db = getDb();
    await db.insert(genusAuthSessions).values({
      id: session.id,
      userId: session.userId,
      tokenHash: session.tokenHash,
      expiresAt: new Date(session.expiresAt),
      createdAt: new Date(session.createdAt),
      revokedAt: session.revokedAt ? new Date(session.revokedAt) : null,
      userAgent: session.userAgent,
      ipHash: session.ipHash,
    });
    return session;
  }

  async findSessionByTokenHash(tokenHash: string): Promise<AuthSession | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(genusAuthSessions)
      .where(eq(genusAuthSessions.tokenHash, tokenHash))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
      userAgent: row.userAgent,
      ipHash: row.ipHash,
    };
  }

  async revokeSession(id: string, revokedAt: string): Promise<void> {
    const db = getDb();
    await db
      .update(genusAuthSessions)
      .set({ revokedAt: new Date(revokedAt) })
      .where(eq(genusAuthSessions.id, id));
  }

  async revokeAllSessionsForUser(userId: string, revokedAt: string): Promise<number> {
    const db = getDb();
    const active = await db
      .select({ id: genusAuthSessions.id })
      .from(genusAuthSessions)
      .where(
        and(eq(genusAuthSessions.userId, userId), isNull(genusAuthSessions.revokedAt))
      );
    if (active.length === 0) return 0;
    await db
      .update(genusAuthSessions)
      .set({ revokedAt: new Date(revokedAt) })
      .where(
        and(eq(genusAuthSessions.userId, userId), isNull(genusAuthSessions.revokedAt))
      );
    return active.length;
  }

  async insertAuditEvent(
    event: Omit<AuthAuditEvent, "id" | "createdAt"> & { id?: string; createdAt?: string }
  ): Promise<AuthAuditEvent> {
    const db = getDb();
    const record: AuthAuditEvent = {
      id: event.id ?? randomUUID(),
      eventType: event.eventType,
      emailNormalized: event.emailNormalized,
      userId: event.userId,
      detail: event.detail,
      createdAt: event.createdAt ?? new Date().toISOString(),
    };
    await db.insert(genusAuthAuditEvents).values({
      id: record.id,
      eventType: record.eventType,
      emailNormalized: record.emailNormalized,
      userId: record.userId,
      detail: record.detail,
      createdAt: new Date(record.createdAt),
    });
    return record;
  }

  async listAuditEvents(filter?: {
    eventType?: AuthEventType;
    emailNormalized?: string;
    userId?: string;
    limit?: number;
  }): Promise<AuthAuditEvent[]> {
    const db = getDb();
    let rows;
    if (filter?.userId) {
      rows = await db
        .select()
        .from(genusAuthAuditEvents)
        .where(eq(genusAuthAuditEvents.userId, filter.userId))
        .orderBy(desc(genusAuthAuditEvents.createdAt));
    } else if (filter?.emailNormalized) {
      rows = await db
        .select()
        .from(genusAuthAuditEvents)
        .where(eq(genusAuthAuditEvents.emailNormalized, filter.emailNormalized))
        .orderBy(desc(genusAuthAuditEvents.createdAt));
    } else {
      rows = await db
        .select()
        .from(genusAuthAuditEvents)
        .orderBy(desc(genusAuthAuditEvents.createdAt));
    }
    const mapped = rows
      .filter((row) => !filter?.eventType || row.eventType === filter.eventType)
      .map((row) => ({
        id: row.id,
        eventType: row.eventType as AuthEventType,
        emailNormalized: row.emailNormalized,
        userId: row.userId,
        detail: row.detail as Record<string, unknown>,
        createdAt: row.createdAt.toISOString(),
      }));
    if (filter?.limit && filter.limit > 0) return mapped.slice(0, filter.limit);
    return mapped;
  }
}
