import "server-only";

import { AuthAdminService, createAuthAdminService } from "@/lib/auth/admin-service";
import { SECTOR_ACCOUNT_DIRECTORY } from "@/lib/auth/directory";
import { DrizzleAuthRepository } from "@/lib/auth/drizzle-repository";
import { MemoryAuthRepository } from "@/lib/auth/memory-repository";
import type { AuthRepository } from "@/lib/auth/repository";
import { AuthService, createAuthService } from "@/lib/auth/service";
import { AuthBackendUnavailableError } from "@/lib/auth/types";

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

function hasDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim() || process.env.DATABASE_URL_UNPOOLED?.trim());
}

function isMigration0016Ready(): boolean {
  return process.env.APPLY_MIGRATION_0016 === "1";
}

/**
 * Bug real (auditoría de "Sesión vencida" intermitente): esta función
 * gateaba el auto-enable de Neon a `VERCEL_ENV==="preview"` explícitamente
 * — el caso "sin GENUS_AUTH_BACKEND=neon pero con DATABASE_URL + 0016
 * aplicada" NUNCA activaba Neon en Production (VERCEL_ENV==="production"),
 * cayendo en MemoryAuthRepository sin ningún error visible. Una sesión en
 * un Map de proceso no es válida en un entorno serverless multi-instancia
 * — cada instancia ve su propia memoria, así que la MISMA sesión aparece
 * "vencida" en cualquier instancia que no sea la que hizo el login.
 *
 * Ahora el auto-enable no depende de VERCEL_ENV: cualquier entorno con
 * DATABASE_URL + 0016 aplicada usa Neon, sea Preview o Production. La
 * salvedad de Preview (evitar login 500 si el branch de Neon todavía no
 * tiene las tablas genus_auth_*) se preserva SOLO para el caso
 * GENUS_AUTH_BACKEND=neon explícito sin 0016 lista.
 */
function isNeonBackendEnabled(): boolean {
  if (process.env.GENUS_AUTH_BACKEND === "memory") return false;
  const hasDb = hasDbConfigured();
  const authSchemaReady = isMigration0016Ready();
  if (process.env.GENUS_AUTH_BACKEND === "neon") {
    if (process.env.VERCEL_ENV === "preview" && !authSchemaReady) return false;
    return true;
  }
  return hasDb && authSchemaReady;
}

/** true en Production real de Vercel — nunca en Preview ni dev local. */
function isProductionDeployment(): boolean {
  return process.env.VERCEL_ENV === "production";
}

/**
 * INVARIANTE: en Production, una sesión válida jamás puede depender de
 * memoria de proceso — Vercel corre múltiples instancias serverless en
 * paralelo, cada una con su propio Map; una sesión creada en la instancia
 * A no existe para la instancia B. Si Neon no está listo en Production,
 * fail closed (lanza AuthBackendUnavailableError → 503) en vez de caer en
 * silencio a memoria: un 503 ruidoso en cada request de auth es
 * infinitamente preferible a sesiones que funcionan "a veces" según qué
 * instancia atienda la request.
 *
 * Preview y desarrollo local NO quedan afectados — el modo demo de Preview
 * sin migración 0016 aplicada (cuentas sembradas en memoria,
 * ensurePreviewMemorySeed) es un comportamiento documentado e
 * intencional, no el defecto que corrige este fix. Memoria explícita
 * (GENUS_AUTH_BACKEND=memory) tampoco dispara el fail-closed en ningún
 * entorno — es una elección deliberada del operador, no un fallback.
 */
function resolveAuthRepository(): AuthRepository {
  if (overrideRepository) return overrideRepository;
  if (isNeonBackendEnabled()) return getSharedNeonRepository();
  const explicitMemory = process.env.GENUS_AUTH_BACKEND === "memory";
  if (isProductionDeployment() && !explicitMemory) {
    throw new AuthBackendUnavailableError(
      "Backend de sesión durable no disponible en Production (falta DATABASE_URL, APPLY_MIGRATION_0016, o GENUS_AUTH_BACKEND). " +
        "Una sesión no puede depender de memoria de proceso en un entorno serverless multi-instancia. " +
        "Configurá GENUS_AUTH_BACKEND=memory explícitamente si esto es intencional."
    );
  }
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
 * - `DATABASE_URL` + `APPLY_MIGRATION_0016=1` (o `GENUS_AUTH_BACKEND=neon`
 *   explícito): Neon, en cualquier entorno — Preview o Production.
 * - Preview sin 0016 lista: `MemoryAuthRepository` (Map en memoria de
 *   proceso), sembrado con cuentas demo documentadas — modo demo
 *   intencional, no durable, no compartido entre instancias.
 * - Production sin Neon listo: **fail closed** — `AuthBackendUnavailableError`
 *   (503), nunca memoria en silencio (ver `resolveAuthRepository`).
 * - Local (sin `VERCEL`): `MemoryAuthRepository`, sin sembrar por defecto.
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
