import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAuthService,
  isAuthBackendDurable,
  setAuthRepositoryForTests,
} from "@/lib/auth/get-auth-service";
import { AuthBackendUnavailableError } from "@/lib/auth/types";
import { MemoryAuthRepository } from "@/lib/auth/memory-repository";

/**
 * Regresión: "Sesión vencida" intermitente — causa raíz arquitectónica.
 * isNeonBackendEnabled() gateaba el auto-enable de Neon a
 * VERCEL_ENV==="preview" explícitamente, así que Production (VERCEL_ENV
 * ==="production") con DATABASE_URL + 0016 aplicada pero SIN
 * GENUS_AUTH_BACKEND=neon explícito caía en MemoryAuthRepository sin
 * ningún error — una sesión creada en una instancia serverless no existe
 * para otra instancia con su propio Map. Ahora: (a) el auto-enable de
 * Neon no depende de VERCEL_ENV, y (b) si Neon no está listo en
 * Production, resolveAuthRepository falla explícito (503) en vez de caer
 * en memoria en silencio.
 */
describe("get-auth-service — selección de backend", () => {
  afterEach(() => {
    setAuthRepositoryForTests(null);
    vi.unstubAllEnvs();
  });

  describe("isAuthBackendDurable — auto-enable de Neon", () => {
    it("Production con DATABASE_URL + 0016 aplicada → Neon, SIN necesitar GENUS_AUTH_BACKEND=neon explícito", () => {
      vi.stubEnv("VERCEL", "1");
      vi.stubEnv("VERCEL_ENV", "production");
      vi.stubEnv("DATABASE_URL", "postgres://fake");
      vi.stubEnv("APPLY_MIGRATION_0016", "1");
      vi.stubEnv("GENUS_AUTH_BACKEND", "");
      expect(isAuthBackendDurable()).toBe(true);
    });

    it("Preview con DATABASE_URL + 0016 aplicada → Neon (comportamiento preexistente, sin cambios)", () => {
      vi.stubEnv("VERCEL", "1");
      vi.stubEnv("VERCEL_ENV", "preview");
      vi.stubEnv("DATABASE_URL", "postgres://fake");
      vi.stubEnv("APPLY_MIGRATION_0016", "1");
      vi.stubEnv("GENUS_AUTH_BACKEND", "");
      expect(isAuthBackendDurable()).toBe(true);
    });

    it("GENUS_AUTH_BACKEND=neon explícito en Production → Neon incluso sin APPLY_MIGRATION_0016", () => {
      vi.stubEnv("VERCEL", "1");
      vi.stubEnv("VERCEL_ENV", "production");
      vi.stubEnv("GENUS_AUTH_BACKEND", "neon");
      vi.stubEnv("APPLY_MIGRATION_0016", "");
      expect(isAuthBackendDurable()).toBe(true);
    });

    it("GENUS_AUTH_BACKEND=neon explícito en Preview SIN 0016 → no durable (evita login 500 por tablas ausentes)", () => {
      vi.stubEnv("VERCEL", "1");
      vi.stubEnv("VERCEL_ENV", "preview");
      vi.stubEnv("GENUS_AUTH_BACKEND", "neon");
      vi.stubEnv("APPLY_MIGRATION_0016", "");
      expect(isAuthBackendDurable()).toBe(false);
    });

    it("GENUS_AUTH_BACKEND=memory fuerza no-durable en cualquier entorno", () => {
      vi.stubEnv("VERCEL", "1");
      vi.stubEnv("VERCEL_ENV", "production");
      vi.stubEnv("DATABASE_URL", "postgres://fake");
      vi.stubEnv("APPLY_MIGRATION_0016", "1");
      vi.stubEnv("GENUS_AUTH_BACKEND", "memory");
      expect(isAuthBackendDurable()).toBe(false);
    });

    it("sin DATABASE_URL ni GENUS_AUTH_BACKEND → no durable en ningún entorno", () => {
      vi.stubEnv("VERCEL_ENV", "production");
      vi.stubEnv("DATABASE_URL", "");
      vi.stubEnv("DATABASE_URL_UNPOOLED", "");
      vi.stubEnv("APPLY_MIGRATION_0016", "");
      vi.stubEnv("GENUS_AUTH_BACKEND", "");
      expect(isAuthBackendDurable()).toBe(false);
    });
  });

  describe("resolveAuthRepository (vía getAuthService) — fail closed en Production", () => {
    it("Production sin Neon listo y sin GENUS_AUTH_BACKEND=memory explícito → AuthBackendUnavailableError (503), NUNCA memoria en silencio", () => {
      vi.stubEnv("VERCEL", "1");
      vi.stubEnv("VERCEL_ENV", "production");
      vi.stubEnv("DATABASE_URL", "");
      vi.stubEnv("DATABASE_URL_UNPOOLED", "");
      vi.stubEnv("APPLY_MIGRATION_0016", "");
      vi.stubEnv("GENUS_AUTH_BACKEND", "");

      let caught: unknown;
      try {
        getAuthService();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(AuthBackendUnavailableError);
      expect((caught as { status: number }).status).toBe(503);
    });

    it("Production con GENUS_AUTH_BACKEND=memory explícito → NO falla, usa memoria a propósito", () => {
      vi.stubEnv("VERCEL", "1");
      vi.stubEnv("VERCEL_ENV", "production");
      vi.stubEnv("DATABASE_URL", "");
      vi.stubEnv("GENUS_AUTH_BACKEND", "memory");
      expect(() => getAuthService()).not.toThrow();
    });

    it("Preview sin Neon listo (demo mode intencional) → NO falla, sigue permitiendo memoria", () => {
      vi.stubEnv("VERCEL", "1");
      vi.stubEnv("VERCEL_ENV", "preview");
      vi.stubEnv("DATABASE_URL", "");
      vi.stubEnv("APPLY_MIGRATION_0016", "");
      vi.stubEnv("GENUS_AUTH_BACKEND", "");
      expect(() => getAuthService()).not.toThrow();
    });

    it("desarrollo local (sin VERCEL) sin Neon listo → NO falla, sigue permitiendo memoria", () => {
      vi.stubEnv("VERCEL", "");
      vi.stubEnv("VERCEL_ENV", "");
      vi.stubEnv("DATABASE_URL", "");
      vi.stubEnv("GENUS_AUTH_BACKEND", "");
      expect(() => getAuthService()).not.toThrow();
    });

    it("override explícito de test (setAuthRepositoryForTests) siempre gana, incluso en Production sin Neon", () => {
      vi.stubEnv("VERCEL", "1");
      vi.stubEnv("VERCEL_ENV", "production");
      vi.stubEnv("DATABASE_URL", "");
      vi.stubEnv("GENUS_AUTH_BACKEND", "");
      setAuthRepositoryForTests(new MemoryAuthRepository());
      expect(() => getAuthService()).not.toThrow();
    });
  });

  describe("por qué memoria no sirve multi-instancia (demostración)", () => {
    it("dos instancias de MemoryAuthRepository NO comparten sesiones — motivo real del fail-closed", async () => {
      const instanceA = new MemoryAuthRepository();
      const instanceB = new MemoryAuthRepository();

      await instanceA.insertUser({
        id: "u1",
        email: "produccion@laboratoriogenus.com.ar",
        emailNormalized: "produccion@laboratoriogenus.com.ar",
        displayName: "Producción",
        sector: "PRODUCCION",
        roleId: "ROL-SU",
        roleLabel: "Supervisora",
        sectorLabel: "Producción",
        jobTitle: "Supervisora de Planta",
        status: "ACTIVO",
        passwordHash: "hash",
        redirectTo: "/mi-trabajo",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastLoginAt: null,
      });
      await instanceA.insertSession({
        id: "s1",
        userId: "u1",
        tokenHash: "tokenhash-1",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        createdAt: new Date().toISOString(),
        revokedAt: null,
        userAgent: null,
        ipHash: null,
      });

      // La MISMA sesión, consultada contra una instancia distinta (simula
      // otra lambda serverless) — no existe ahí. Esto es exactamente lo
      // que produce "Sesión vencida" intermitente si Production cae en
      // memoria: depende de qué instancia atienda cada request.
      const seenByA = await instanceA.findSessionByTokenHash("tokenhash-1");
      const seenByB = await instanceB.findSessionByTokenHash("tokenhash-1");
      expect(seenByA).not.toBeNull();
      expect(seenByB).toBeNull();
    });
  });
});
