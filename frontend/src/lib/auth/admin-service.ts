import "server-only";

import { normalizeEmail } from "@/lib/auth/directory";
import { hashPassword } from "@/lib/auth/password";
import type { AuthRepository } from "@/lib/auth/repository";
import { invalidateNeonReadCache } from "@/lib/db/neon-read-cache";
import { SESSION_CACHE_PREFIX } from "@/lib/auth/service";
import {
  countActiveSuperadmins,
  isSuperadminEmail,
} from "@/lib/auth/superadmin";
import {
  AuthConflictError,
  AuthNotFoundError,
  AuthValidationError,
  toPublicAuthUser,
  type AuthActor,
  type AuthAuditEvent,
  type AuthUser,
  type AuthUserStatus,
  type PublicAuthUser,
} from "@/lib/auth/types";
import {
  OPERATIONAL_SECTOR_IDS,
  SECTOR_LABELS,
  type SectorId,
} from "@/types/operational/sector";

function nowIso(): string {
  return new Date().toISOString();
}

const ALLOWED_STATUSES: AuthUserStatus[] = ["ACTIVO", "BLOQUEADO", "INACTIVO"];
const MIN_PASSWORD_LEN = 8;

export type AdminUserPatch = {
  displayName?: string;
  email?: string;
  sector?: string;
  status?: AuthUserStatus;
  reason?: string;
};

export type AdminPasswordResetInput = {
  newPassword: string;
  reason?: string;
};

function assertSector(sector: string): SectorId {
  const normalized = sector.trim().toUpperCase();
  if (!(OPERATIONAL_SECTOR_IDS as readonly string[]).includes(normalized)) {
    throw new AuthValidationError("Sector inválido.");
  }
  return normalized as SectorId;
}

function sanitizeAuditDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    const k = key.toLowerCase();
    if (
      k.includes("password") ||
      k.includes("hash") ||
      k.includes("token") ||
      k.includes("secret")
    ) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Operaciones de administración de usuarios (superadmin).
 * Nunca expone passwordHash ni contraseñas en claro.
 */
export class AuthAdminService {
  constructor(private readonly repo: AuthRepository) {}

  async listPublicUsers(): Promise<PublicAuthUser[]> {
    const users = await this.repo.listUsers();
    return users
      .map(toPublicAuthUser)
      .sort((a, b) => a.sector.localeCompare(b.sector) || a.email.localeCompare(b.email));
  }

  async updateUser(
    actor: AuthActor,
    userId: string,
    patch: AdminUserPatch
  ): Promise<PublicAuthUser> {
    const user = await this.repo.getUserById(userId);
    if (!user) throw new AuthNotFoundError();

    const reason = (patch.reason ?? "").trim();
    if (!reason) throw new AuthValidationError("Motivo obligatorio.");

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const update: Partial<AuthUser> = { updatedAt: nowIso() };

    if (patch.displayName !== undefined) {
      const displayName = patch.displayName.trim();
      if (!displayName) throw new AuthValidationError("Nombre visible inválido.");
      if (displayName !== user.displayName) {
        changes.displayName = { from: user.displayName, to: displayName };
        update.displayName = displayName;
      }
    }

    if (patch.email !== undefined) {
      const email = patch.email.trim();
      if (!email || !email.includes("@")) {
        throw new AuthValidationError("Email inválido.");
      }
      const emailNormalized = normalizeEmail(email);
      if (emailNormalized !== user.emailNormalized) {
        await this.assertCanChangeSuperadminEmail(user, emailNormalized);
        const conflict = await this.repo.findUserByEmailNormalized(emailNormalized);
        if (conflict && conflict.id !== user.id) {
          throw new AuthConflictError("Ya existe un usuario con ese email.");
        }
        changes.email = { from: user.email, to: email };
        update.email = email;
        update.emailNormalized = emailNormalized;
      }
    }

    if (patch.sector !== undefined) {
      const sector = assertSector(patch.sector);
      if (sector !== user.sector) {
        changes.sector = { from: user.sector, to: sector };
        update.sector = sector;
        update.sectorLabel = SECTOR_LABELS[sector];
      }
    }

    if (patch.status !== undefined) {
      if (!ALLOWED_STATUSES.includes(patch.status)) {
        throw new AuthValidationError("Estado inválido.");
      }
      if (patch.status !== user.status) {
        await this.assertCanChangeSuperadminStatus(user, patch.status);
        changes.status = { from: user.status, to: patch.status };
        update.status = patch.status;
      }
    }

    if (Object.keys(changes).length === 0) {
      return toPublicAuthUser(user);
    }

    const updated = await this.repo.updateUser(userId, update);
    if (!updated) throw new AuthNotFoundError();

    if (patch.status && patch.status !== "ACTIVO") {
      const revoked = await this.repo.revokeAllSessionsForUser(userId, nowIso());
      invalidateNeonReadCache(SESSION_CACHE_PREFIX);
      await this.repo.insertAuditEvent({
        eventType: "ADMIN_SESSIONS_REVOKED",
        emailNormalized: updated.emailNormalized,
        userId: updated.id,
        detail: sanitizeAuditDetail({
          actorUserId: actor.userId,
          actorEmail: normalizeEmail(actor.email),
          reason,
          revokedCount: revoked,
          cause: "status_change",
        }),
      });
    }

    await this.repo.insertAuditEvent({
      eventType: "ADMIN_USER_UPDATE",
      emailNormalized: updated.emailNormalized,
      userId: updated.id,
      detail: sanitizeAuditDetail({
        actorUserId: actor.userId,
        actorEmail: normalizeEmail(actor.email),
        reason,
        changes,
      }),
    });

    return toPublicAuthUser(updated);
  }

  async resetPassword(
    actor: AuthActor,
    userId: string,
    input: AdminPasswordResetInput
  ): Promise<{ ok: true; sessionsRevoked: number }> {
    const user = await this.repo.getUserById(userId);
    if (!user) throw new AuthNotFoundError();

    const reason = (input.reason ?? "").trim();
    if (!reason) throw new AuthValidationError("Motivo obligatorio.");

    const newPassword = input.newPassword ?? "";
    if (newPassword.length < MIN_PASSWORD_LEN) {
      throw new AuthValidationError(
        `La contraseña debe tener al menos ${MIN_PASSWORD_LEN} caracteres.`
      );
    }

    const passwordHash = await hashPassword(newPassword);
    await this.repo.updateUser(userId, {
      passwordHash,
      updatedAt: nowIso(),
    });
    const sessionsRevoked = await this.repo.revokeAllSessionsForUser(userId, nowIso());
    invalidateNeonReadCache(SESSION_CACHE_PREFIX);

    await this.repo.insertAuditEvent({
      eventType: "ADMIN_PASSWORD_RESET",
      emailNormalized: user.emailNormalized,
      userId: user.id,
      detail: sanitizeAuditDetail({
        actorUserId: actor.userId,
        actorEmail: normalizeEmail(actor.email),
        reason,
        sessionsRevoked,
      }),
    });

    return { ok: true, sessionsRevoked };
  }

  async revokeSessions(
    actor: AuthActor,
    userId: string,
    reasonRaw?: string
  ): Promise<{ ok: true; sessionsRevoked: number }> {
    const user = await this.repo.getUserById(userId);
    if (!user) throw new AuthNotFoundError();
    const reason = (reasonRaw ?? "").trim();
    if (!reason) throw new AuthValidationError("Motivo obligatorio.");

    const sessionsRevoked = await this.repo.revokeAllSessionsForUser(userId, nowIso());
    invalidateNeonReadCache(SESSION_CACHE_PREFIX);
    await this.repo.insertAuditEvent({
      eventType: "ADMIN_SESSIONS_REVOKED",
      emailNormalized: user.emailNormalized,
      userId: user.id,
      detail: sanitizeAuditDetail({
        actorUserId: actor.userId,
        actorEmail: normalizeEmail(actor.email),
        reason,
        sessionsRevoked,
      }),
    });
    return { ok: true, sessionsRevoked };
  }

  async listAuditForUser(userId: string, limit = 50): Promise<AuthAuditEvent[]> {
    const user = await this.repo.getUserById(userId);
    if (!user) throw new AuthNotFoundError();
    const events = await this.repo.listAuditEvents({ userId, limit });
    return events.map((e) => ({
      ...e,
      detail: sanitizeAuditDetail(e.detail ?? {}),
    }));
  }

  private async assertCanChangeSuperadminStatus(
    user: AuthUser,
    nextStatus: AuthUserStatus
  ): Promise<void> {
    if (!isSuperadminEmail(user.email)) return;
    if (nextStatus === "ACTIVO") return;
    const users = await this.repo.listUsers();
    const remaining = countActiveSuperadmins(users, { excludeUserId: user.id });
    if (remaining === 0) {
      throw new AuthValidationError(
        "No se puede desactivar al último SUPERADMIN activo."
      );
    }
  }

  private async assertCanChangeSuperadminEmail(
    user: AuthUser,
    nextEmailNormalized: string
  ): Promise<void> {
    if (!isSuperadminEmail(user.email)) return;
    if (isSuperadminEmail(nextEmailNormalized)) return;
    const users = await this.repo.listUsers();
    const remaining = countActiveSuperadmins(users, { excludeUserId: user.id });
    if (remaining === 0) {
      throw new AuthValidationError(
        "No se puede cambiar el email del último SUPERADMIN activo fuera del allowlist."
      );
    }
  }
}

export function createAuthAdminService(repo: AuthRepository): AuthAdminService {
  return new AuthAdminService(repo);
}
