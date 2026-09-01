import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "@/lib/auth/cookies";
import { SECTOR_ACCOUNT_DIRECTORY } from "@/lib/auth/directory";
import { setAuthRepositoryForTests } from "@/lib/auth/get-auth-service";
import { MemoryAuthRepository } from "@/lib/auth/memory-repository";
import { AuthService } from "@/lib/auth/service";
import { AuthUnauthorizedError } from "@/lib/auth/types";
import { inventoryErrorResponse, resolveInventoryActor } from "@/lib/inventory/http";
import {
  InventoryForbiddenError,
  InventoryValidationError,
} from "@/lib/inventory/inventory-service";

const ANA = SECTOR_ACCOUNT_DIRECTORY[0]; // ELABORACION

function requestWithCookie(token: string | null, extraHeaders?: Record<string, string>): Request {
  const headers = new Headers(extraHeaders);
  if (token) headers.set("cookie", `${COOKIE_NAME}=${token}`);
  return new Request("https://example.test/api/v1/inventory", { headers });
}

describe("resolveInventoryActor / inventoryErrorResponse", () => {
  let repo: MemoryAuthRepository;
  let service: AuthService;

  beforeEach(async () => {
    repo = new MemoryAuthRepository();
    service = new AuthService(repo);
    setAuthRepositoryForTests(repo);
    await service.ensureUsersSeeded({ [ANA.email]: "clave-segura-1" });
  });

  afterEach(() => {
    setAuthRepositoryForTests(null);
    vi.unstubAllEnvs();
  });

  it("resuelve el InventoryActor desde una cookie de sesión válida", async () => {
    const { token } = await service.login(ANA.email, "clave-segura-1");
    const actor = await resolveInventoryActor(requestWithCookie(token));
    expect(actor).toMatchObject({ email: ANA.email, sector: ANA.sector });
  });

  it("sin sesión lanza AuthUnauthorizedError (401), no InventoryForbiddenError", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(resolveInventoryActor(requestWithCookie(null))).rejects.toBeInstanceOf(
      AuthUnauthorizedError
    );
  });

  it("un x-genus-actor-sector que no coincide con la sesión lanza InventoryForbiddenError", async () => {
    const { token } = await service.login(ANA.email, "clave-segura-1");
    const request = requestWithCookie(token, { "x-genus-actor-sector": "CALIDAD" });
    await expect(resolveInventoryActor(request)).rejects.toBeInstanceOf(InventoryForbiddenError);
  });

  it("inventoryErrorResponse mapea sesión inválida a HTTP 401 (no 403)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    let caught: unknown;
    try {
      await resolveInventoryActor(requestWithCookie(null));
    } catch (err) {
      caught = err;
    }
    const response = inventoryErrorResponse(caught);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("AUTH_UNAUTHORIZED");
  });

  it("inventoryErrorResponse mapea sector incorrecto a HTTP 403 (autenticado, sin permiso)", async () => {
    const { token } = await service.login(ANA.email, "clave-segura-1");
    const request = requestWithCookie(token, { "x-genus-actor-sector": "CALIDAD" });
    let caught: unknown;
    try {
      await resolveInventoryActor(request);
    } catch (err) {
      caught = err;
    }
    const response = inventoryErrorResponse(caught);
    expect(response.status).toBe(403);
  });
});

/**
 * Regresión: resolveInventoryActor convertía un AuthUnauthorizedError real
 * (401 = no autenticado) en InventoryForbiddenError (403 = autenticado sin
 * permiso) — la sesión ausente/vencida se reportaba como si el usuario
 * estuviera logueado pero sin permisos.
 */
describe("inventoryErrorResponse — semántica 401 vs 403 vs 400", () => {
  it("AuthUnauthorizedError → 401, no 403", async () => {
    const res = inventoryErrorResponse(new AuthUnauthorizedError());
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.code).toBe("AUTH_UNAUTHORIZED");
  });

  it("InventoryForbiddenError sigue siendo 403 (autenticado sin permiso)", async () => {
    const res = inventoryErrorResponse(new InventoryForbiddenError("Sector no autorizado."));
    expect(res.status).toBe(403);
  });

  it("InventoryValidationError sigue siendo 400 (request inválida, no auth)", async () => {
    const res = inventoryErrorResponse(new InventoryValidationError("Cantidad inválida."));
    expect(res.status).toBe(400);
  });
});
