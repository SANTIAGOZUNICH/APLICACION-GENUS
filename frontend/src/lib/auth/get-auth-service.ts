import "server-only";

import { AuthAdminService, createAuthAdminService } from "@/lib/auth/admin-service";
import { DrizzleAuthRepository } from "@/lib/auth/drizzle-repository";
import { MemoryAuthRepository } from "@/lib/auth/memory-repository";
import type { AuthRepository } from "@/lib/auth/repository";
import { AuthService, createAuthService } from "@/lib/auth/service";

export { createAuthService, createAuthAdminService };

let sharedMemoryRepository: MemoryAuthRepository | null = null;
let sharedNeonRepository: DrizzleAuthRepository | null = null;
let overrideRepository: AuthRepository | null = null;
let overrideService: AuthService | null = null;

/** Solo tests: inyectar un repositorio (memoria fresca, spy, etc). Pasar null para volver al default. */
export function setAuthRepositoryForTests(repository: AuthRepository | null): void {
  overrideRepository = repository;
}

/** Solo tests: inyectar el servicio completo (para stubbing de alto nivel). Pasar null para volver al default. */
export function setAuthServiceForTests(service: AuthService | null): void {
  overrideService = service;
}

function getSharedMemoryRepository(): MemoryAuthRepository {
  if (!sharedMemoryRepository) {
    sharedMemoryRepository = new MemoryAuthRepository();
  }
  return sharedMemoryRepository;
}

function getSharedNeonRepository(): DrizzleAuthRepository {
  if (!sharedNeonRepository) {
    sharedNeonRepository = new DrizzleAuthRepository();
  }
  return sharedNeonRepository;
}

function isNeonBackendEnabled(): boolean {
  if (process.env.GENUS_AUTH_BACKEND === "memory") return false;
  if (process.env.GENUS_AUTH_BACKEND === "neon") return true;
  // Preview con Neon + 0016 aplicada: backend durable por defecto.
  // Production nunca se autoactiva (requiere GENUS_AUTH_BACKEND=neon explícito).
  return (
    process.env.VERCEL_ENV === "preview" &&
    Boolean(process.env.DATABASE_URL?.trim() || process.env.DATABASE_URL_UNPOOLED?.trim())
  );
}

function resolveAuthRepository(): AuthRepository {
  if (overrideRepository) return overrideRepository;
  if (isNeonBackendEnabled()) return getSharedNeonRepository();
  return getSharedMemoryRepository();
}

/**
 * Devuelve el servicio de autenticación de Genus Auth.
 *
 * La migración 0016 (drizzle/0016_genus_auth.sql) que crea
 * genus_auth_users / genus_auth_sessions / genus_auth_audit_events queda
 * **diferida** hasta APPLY_MIGRATION_0016=1 (ver
 * scripts/migrate-if-database.mjs).
 *
 * Backend:
 * - Por defecto: `MemoryAuthRepository` (Map en memoria de proceso,
 *   singleton a nivel de módulo). No es durable — no sobrevive reinicios
 *   ni se comparte entre instancias/regiones de Preview.
 * - `GENUS_AUTH_BACKEND=neon`: usa `DrizzleAuthRepository` sobre Neon.
 *   Solo debe activarse una vez aplicada 0016; de lo contrario, las
 *   queries fallarán por tablas inexistentes.
 */
export function getAuthService(): AuthService {
  if (overrideService) return overrideService;
  return createAuthService(resolveAuthRepository());
}

export function getAuthAdminService(): AuthAdminService {
  return createAuthAdminService(resolveAuthRepository());
}

/** true recién cuando 0016 esté aplicada y GENUS_AUTH_BACKEND=neon esté activo. */
export function isAuthBackendDurable(): boolean {
  return isNeonBackendEnabled();
}
