import { describe, expect, it } from "vitest";
import { authErrorResponse } from "@/lib/auth/http";
import {
  AuthBackendUnavailableError,
  AuthBlockedError,
  AuthInvalidCredentialsError,
  AuthRateLimitedError,
  AuthUnauthorizedError,
} from "@/lib/auth/types";

/**
 * Contrato de semántica HTTP para auth (ver informe "Sesión vencida"):
 * 401 = no autenticado, 403 = autenticado sin permiso, 5xx = error de
 * infraestructura — un error real (DB caída, backend no disponible) nunca
 * debe mapear a 401, porque el cliente (session-authority.ts) solo trata
 * 401 confirmado como sesión vencida.
 */
describe("authErrorResponse — contrato de status HTTP", () => {
  it("AuthUnauthorizedError → 401", async () => {
    const res = authErrorResponse(new AuthUnauthorizedError());
    expect(res.status).toBe(401);
  });

  it("AuthBlockedError → 403 (autenticado, bloqueado — no es 'sesión vencida')", async () => {
    const res = authErrorResponse(new AuthBlockedError());
    expect(res.status).toBe(403);
  });

  it("AuthRateLimitedError → 429, no 401", async () => {
    const res = authErrorResponse(new AuthRateLimitedError());
    expect(res.status).toBe(429);
  });

  it("AuthBackendUnavailableError → 503, no 401 — backend durable no configurado es un error de infraestructura", async () => {
    const res = authErrorResponse(new AuthBackendUnavailableError());
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.code).toBe("AUTH_BACKEND_UNAVAILABLE");
  });

  it("un error genérico (DB caída, timeout) → 500, NUNCA 401", async () => {
    const res = authErrorResponse(new Error("connection terminated unexpectedly"));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.code).toBe("AUTH_INTERNAL_ERROR");
  });

  it("un error genérico no filtra su mensaje original al cliente", async () => {
    const res = authErrorResponse(new Error("DATABASE_URL=postgres://user:pass@host/db"));
    const body = await res.json();
    expect(body.error).not.toContain("DATABASE_URL");
    expect(body.error).not.toContain("postgres://");
  });

  it("AuthInvalidCredentialsError sigue siendo 401 (no es un error de infraestructura)", async () => {
    const res = authErrorResponse(new AuthInvalidCredentialsError());
    expect(res.status).toBe(401);
  });
});
