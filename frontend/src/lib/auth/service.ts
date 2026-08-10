import "server-only";

import { randomUUID } from "node:crypto";
import {
  LOGIN_MAX_FAILS,
  LOGIN_RATE_LIMIT_WINDOW_MS,
  SESSION_TTL_SECONDS,
} from "@/lib/auth/constants";
import { normalizeEmail, SECTOR_ACCOUNT_DIRECTORY, type SectorAccountDirectoryEntry } from "@/lib/auth/directory";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import type { AuthRepository } from "@/lib/auth/repository";
import { createOpaqueToken, hashToken } from "@/lib/auth/session-token";
import { getNeonReadCache, invalidateNeonReadCache, setNeonReadCache } from "@/lib/db/neon-read-cache";
import {
  AuthBlockedError,
  AuthInvalidCredentialsError,
  AuthRateLimitedError,
  toPublicAuthUser,
  type AuthActor,
  type AuthEventType,
  type AuthUser,
  type LoginMeta,
  type LoginResult,
} from "@/lib/auth/types";

function nowIso(): string {
  return new Date().toISOString();
}

/** TTL corto: acota staleness de revocación/expiración a una ventana chica. */
const SESSION_RESOLVE_CACHE_TTL_MS = 10_000;

/** Prefijo compartido con admin-service.ts: revocar en bloque (reset password,
 *  bloqueo de usuario) invalida TODO el caché de sesión por este prefijo,
 *  ya que esas operaciones no conocen el tokenHash de las sesiones activas. */
export const SESSION_CACHE_PREFIX = "auth:session:";

function sessionCacheKey(tokenHash: string): string {
  return `${SESSION_CACHE_PREFIX}${tokenHash}`;
}

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

export interface EnsureUsersSeededOptions {
  /** Sobrescribe password_hash de usuarios ya existentes (GENUS_AUTH_SEED_FORCE_PASSWORD). */
  forcePassword?: boolean;
}

export interface EnsureUsersSeededResult {
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
}

/**
 * Reglas de negocio de Genus Auth: login/logout, resolución de sesión,
 * seed idempotente y auditoría. Nunca persiste ni loguea passwords en
 * texto plano; los eventos de auditoría solo registran metadatos (motivo,
 * email normalizado, userId).
 */
export class AuthService {
  private readonly failedAttempts = new Map<string, RateLimitEntry>();

  constructor(private readonly repo: AuthRepository) {}

  async login(email: string, password: string, meta: LoginMeta = {}): Promise<LoginResult> {
    const emailNormalized = normalizeEmail(email ?? "");
    this.assertNotRateLimited(emailNormalized);

    const user = await this.repo.findUserByEmailNormalized(emailNormalized);
    if (!user) {
      await this.registerFailedAttempt(emailNormalized);
      await this.audit("LOGIN_FAIL", emailNormalized, null, { reason: "unknown_email" });
      throw new AuthInvalidCredentialsError();
    }

    if (user.status === "BLOQUEADO") {
      await this.audit("BLOCKED", emailNormalized, user.id, {});
      throw new AuthBlockedError();
    }

    if (user.status === "INACTIVO") {
      await this.audit("LOGIN_FAIL", emailNormalized, user.id, { reason: "inactive" });
      throw new AuthInvalidCredentialsError();
    }

    const valid = await verifyPassword(password ?? "", user.passwordHash);
    if (!valid) {
      await this.registerFailedAttempt(emailNormalized);
      await this.audit("LOGIN_FAIL", emailNormalized, user.id, { reason: "bad_password" });
      throw new AuthInvalidCredentialsError();
    }

    this.clearFailedAttempts(emailNormalized);

    const token = createOpaqueToken();
    const tokenHash = hashToken(token);
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

    await this.repo.insertSession({
      id: randomUUID(),
      userId: user.id,
      tokenHash,
      expiresAt,
      createdAt,
      revokedAt: null,
      userAgent: meta.userAgent ?? null,
      ipHash: meta.ipHash ?? null,
    });

    const updatedUser = (await this.repo.updateUser(user.id, { lastLoginAt: createdAt })) ?? user;
    await this.audit("LOGIN_OK", emailNormalized, user.id, {});

    return { user: toPublicAuthUser(updatedUser), token, expiresAt };
  }

  async logout(token: string | null | undefined): Promise<void> {
    if (!token) return;
    const tokenHash = hashToken(token);
    invalidateNeonReadCache(sessionCacheKey(tokenHash));
    const session = await this.repo.findSessionByTokenHash(tokenHash);
    if (!session || session.revokedAt) return;
    await this.repo.revokeSession(session.id, nowIso());
    await this.audit("LOGOUT", null, session.userId, {});
  }

  /**
   * Resuelve un actor autenticado a partir del token de cookie. null si no
   * hay sesión válida. Cacheado por instancia (TTL corto) — el connectivity
   * monitor del cliente golpea /auth/me cada ~8s por pestaña; sin esto cada
   * poll disparaba 2 SELECT a Neon (sesión + usuario) sin motivo, uno de los
   * mayores consumidores de cuota identificados en la auditoría.
   */
  async resolveSession(token: string | null | undefined): Promise<AuthActor | null> {
    if (!token) return null;
    const tokenHash = hashToken(token);
    const cacheKey = sessionCacheKey(tokenHash);
    const cached = getNeonReadCache<AuthActor | null>(cacheKey);
    if (cached !== null) return cached;

    const resolved = await this.resolveSessionUncached(tokenHash);
    setNeonReadCache(cacheKey, resolved, SESSION_RESOLVE_CACHE_TTL_MS);
    return resolved;
  }

  private async resolveSessionUncached(tokenHash: string): Promise<AuthActor | null> {
    const session = await this.repo.findSessionByTokenHash(tokenHash);
    if (!session) return null;
    if (session.revokedAt) return null;
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      await this.audit("SESSION_EXPIRED", null, session.userId, { sessionId: session.id });
      return null;
    }

    const user = await this.repo.getUserById(session.userId);
    if (!user || user.status !== "ACTIVO") return null;

    return this.toActor(user);
  }

  /**
   * Siembra usuarios desde el directorio + un mapa de contraseñas en texto
   * plano provisto por el llamador (nunca desde este módulo: las
   * contraseñas siempre vienen de variables de entorno, ver
   * scripts/seed-genus-auth.mjs). Idempotente: si el usuario ya existe, no
   * pisa el password_hash salvo `options.forcePassword`.
   */
  async ensureUsersSeeded(
    passwordsByEmail: Record<string, string>,
    directory: SectorAccountDirectoryEntry[] = SECTOR_ACCOUNT_DIRECTORY,
    options: EnsureUsersSeededOptions = {}
  ): Promise<EnsureUsersSeededResult> {
    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const entry of directory) {
      const emailNormalized = normalizeEmail(entry.email);
      const plainPassword = passwordsByEmail[entry.email] ?? passwordsByEmail[emailNormalized];
      const existing = await this.repo.findUserByEmailNormalized(emailNormalized);

      if (existing) {
        if (options.forcePassword && plainPassword) {
          const passwordHash = await hashPassword(plainPassword);
          await this.repo.updateUser(existing.id, { passwordHash, updatedAt: nowIso() });
          updatedCount += 1;
        } else {
          skippedCount += 1;
        }
        continue;
      }

      if (!plainPassword) {
        skippedCount += 1;
        continue;
      }

      const passwordHash = await hashPassword(plainPassword);
      const now = nowIso();
      await this.repo.insertUser({
        id: randomUUID(),
        email: entry.email,
        emailNormalized,
        displayName: entry.displayName,
        sector: entry.sector,
        roleId: entry.role,
        roleLabel: entry.roleLabel,
        sectorLabel: entry.sectorLabel,
        jobTitle: entry.jobTitle,
        status: "ACTIVO",
        passwordHash,
        redirectTo: entry.redirectTo,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: null,
      });
      createdCount += 1;
    }

    return { createdCount, updatedCount, skippedCount };
  }

  private toActor(user: AuthUser): AuthActor {
    return {
      userId: user.id,
      email: user.email,
      sector: user.sector,
      displayName: user.displayName,
      roleId: user.roleId,
      roleLabel: user.roleLabel,
      sectorLabel: user.sectorLabel,
      jobTitle: user.jobTitle,
      redirectTo: user.redirectTo,
    };
  }

  private assertNotRateLimited(emailNormalized: string): void {
    const entry = this.failedAttempts.get(emailNormalized);
    if (!entry) return;
    if (Date.now() - entry.windowStart > LOGIN_RATE_LIMIT_WINDOW_MS) {
      this.failedAttempts.delete(emailNormalized);
      return;
    }
    if (entry.count >= LOGIN_MAX_FAILS) {
      throw new AuthRateLimitedError();
    }
  }

  private async registerFailedAttempt(emailNormalized: string): Promise<void> {
    const now = Date.now();
    const entry = this.failedAttempts.get(emailNormalized);
    if (!entry || now - entry.windowStart > LOGIN_RATE_LIMIT_WINDOW_MS) {
      this.failedAttempts.set(emailNormalized, { count: 1, windowStart: now });
      return;
    }
    entry.count += 1;
  }

  private clearFailedAttempts(emailNormalized: string): void {
    this.failedAttempts.delete(emailNormalized);
  }

  private async audit(
    eventType: AuthEventType,
    emailNormalized: string | null,
    userId: string | null,
    detail: Record<string, unknown>
  ): Promise<void> {
    await this.repo.insertAuditEvent({ eventType, emailNormalized, userId, detail });
  }
}

export function createAuthService(repo: AuthRepository): AuthService {
  return new AuthService(repo);
}
