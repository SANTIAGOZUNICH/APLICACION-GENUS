import "server-only";

import { AuthAdminService, createAuthAdminService } from "@/lib/auth/admin-service";
import { SECTOR_ACCOUNT_DIRECTORY } from "@/lib/auth/directory";
import { DrizzleAuthRepository } from "@/lib/auth/drizzle-repository";
import { MemoryAuthRepository } from "@/lib/auth/memory-repository";
import type { AuthRepository } from "@/lib/auth/repository";
import { AuthService, createAuthService } from "@/lib/auth/service";

export { createAuthService, createAuthAdminService };

let sharedMemoryRepository: MemoryAuthRepository | null = null;
let sharedNeonRepository: DrizzleAuthRepository | null = null;
let overrideRepository: AuthRepository | null = null;
let overrideService: AuthService | null = null;
let memorySeedPromise: Promise<void> | null = null;

/** Solo tests: inyectar un repositorio (memoria fresca, spy, etc). Pasar null para volver al default. */
export function setAuthRepositoryForTests(repository: AuthRepository | null): void {
  overrideRepository = repository;
  memorySeedPromise = null;
}

/** Solo tests: inyectar el servicio completo (para stubbing de alto nivel). Pasar null para volver al default. */
export function setAuthServiceForTests(service: AuthService | null): void {
  overrideService = service;
}

/**
 * Contraseñas demo documentadas (docss/32) — solo para backend memoria en Preview
 * cuando 0016 no está aplicada. Si existe GENUS_AUTH_PASSWORD_*, tiene prioridad.
 */
/**
 * Exportadas (no solo internas) para poder testear en directory-parity.test.ts
 * que cubren exactamente los mismos emails que SECTOR_ACCOUNT_DIRECTORY — el
 * incidente de Codificado sin poder loguearse en Preview fue justamente una
 * cuenta creada en un lugar (directory.ts) pero sin contraseña sembrada
 * porque GENUS_AUTH_PASSWORD_CODIFICADO faltaba al correr el seed; este test
 * no puede detectar ESO (es un dato faltante en Neon, no un bug de código),
 * pero si en el futuro se agrega un sector nuevo y alguien olvida agregarlo
 * acá o en seed-genus-auth.mjs, esto lo va a marcar en CI antes de llegar a
 * Preview.
 */
export const PREVIEW_MEMORY_DEMO_PASSWORDS: Record<string, string> = {
  "elaboracion@laboratoriogenus.com.ar": "elaboracion123",
  "emasivo@laboratoriogenus.com.ar": "emasivo123",
  "epremium@laboratoriogenus.com.ar": "epremium123",
  "calidad@laboratoriogenus.com.ar": "calidad123",
  "produccion@laboratoriogenus.com.ar": "produccion123",
  "mp@laboratoriogenus.com.ar": "mp123",
  "codificado@laboratoriogenus.com.ar": "codificado123",
  "deposito@laboratoriogenus.com.ar": "deposito123",
};

export const PASSWORD_ENV_BY_EMAIL: Record<string, string> = {
  "elaboracion@laboratoriogenus.com.ar": "GENUS_AUTH_PASSWORD_ELABORACION",
  "emasivo@laboratoriogenus.com.ar": "GENUS_AUTH_PASSWORD_ENVASADO_MASIVO",
  "epremium@laboratoriogenus.com.ar": "GENUS_AUTH_PASSWORD_ENVASADO_PREMIUM",
  "calidad@laboratoriogenus.com.ar": "GENUS_AUTH_PASSWORD_CALIDAD",
  "produccion@laboratoriogenus.com.ar": "GENUS_AUTH_PASSWORD_PRODUCCION",
  "mp@laboratoriogenus.com.ar": "GENUS_AUTH_PASSWORD_MATERIA_PRIMA",
  "codificado@laboratoriogenus.com.ar": "GENUS_AUTH_PASSWORD_CODIFICADO",
  "deposito@laboratoriogenus.com.ar": "GENUS_AUTH_PASSWORD_DEPOSITO",
};

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
  const hasDb = Boolean(
    process.env.DATABASE_URL?.trim() || process.env.DATABASE_URL_UNPOOLED?.trim()
  );
  const authSchemaReady = process.env.APPLY_MIGRATION_0016 === "1";
  if (process.env.GENUS_AUTH_BACKEND === "neon") {
    // En Preview, sin 0016 el branch Neon suele no tener genus_auth_* → login 500.
    if (process.env.VERCEL_ENV === "preview" && !authSchemaReady) return false;
    return true;
  }
  // Auto Preview solo con 0016 autorizada + DATABASE_URL.
  return process.env.VERCEL_ENV === "preview" && authSchemaReady && hasDb;
}

function resolveAuthRepository(): AuthRepository {
  if (overrideRepository) return overrideRepository;
  if (isNeonBackendEnabled()) return getSharedNeonRepository();
  return getSharedMemoryRepository();
}

function buildPreviewMemoryPasswords(): Record<string, string> {
  const out: Record<string, string> = { ...PREVIEW_MEMORY_DEMO_PASSWORDS };
  for (const [email, envName] of Object.entries(PASSWORD_ENV_BY_EMAIL)) {
    const fromEnv = process.env[envName]?.trim();
    if (fromEnv) out[email] = fromEnv;
  }
  return out;
}

async function ensurePreviewMemorySeed(service: AuthService): Promise<void> {
  if (isNeonBackendEnabled()) return;
  if (process.env.VERCEL_ENV !== "preview") return;
  if (!memorySeedPromise) {
    memorySeedPromise = service
      .ensureUsersSeeded(buildPreviewMemoryPasswords(), SECTOR_ACCOUNT_DIRECTORY)
      .then(() => undefined)
      .catch((err) => {
        memorySeedPromise = null;
        console.error("[auth] Preview memory seed falló:", err);
      });
  }
  await memorySeedPromise;
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
 * - Preview sin 0016: siembra cuentas demo documentadas en memoria.
 * - `GENUS_AUTH_BACKEND=neon` o Preview+APPLY_MIGRATION_0016=1: Neon.
 */
export function getAuthService(): AuthService {
  if (overrideService) return overrideService;
  return createAuthService(resolveAuthRepository());
}

/** Auth service listo para login (siembra memoria Preview si corresponde). */
export async function getAuthServiceReady(): Promise<AuthService> {
  const service = getAuthService();
  await ensurePreviewMemorySeed(service);
  return service;
}

export function getAuthAdminService(): AuthAdminService {
  return createAuthAdminService(resolveAuthRepository());
}

/** true recién cuando 0016 esté aplicada y el backend Neon esté activo. */
export function isAuthBackendDurable(): boolean {
  return isNeonBackendEnabled();
}
