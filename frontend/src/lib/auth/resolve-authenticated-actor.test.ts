import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "@/lib/auth/cookies";
import { SECTOR_ACCOUNT_DIRECTORY } from "@/lib/auth/directory";
import { setAuthRepositoryForTests } from "@/lib/auth/get-auth-service";
import { MemoryAuthRepository } from "@/lib/auth/memory-repository";
import { resolveAuthenticatedActor } from "@/lib/auth/resolve-authenticated-actor";
import { AuthService } from "@/lib/auth/service";
import { AuthUnauthorizedError } from "@/lib/auth/types";

const ANA = SECTOR_ACCOUNT_DIRECTORY[0]; // elaboracion@laboratoriogenus.com.ar
const CALIDAD = SECTOR_ACCOUNT_DIRECTORY.find((entry) => entry.sector === "CALIDAD")!;

function requestWithCookie(token: string | null): Request {
  const headers = new Headers();
  if (token) headers.set("cookie", `${COOKIE_NAME}=${token}`);
  return new Request("https://example.test/api/v1/orders", { headers });
}

function requestWithHeader(email: string | null): Request {
  const headers = new Headers();
  if (email) headers.set("x-genus-actor-email", email);
  return new Request("https://example.test/api/v1/orders", { headers });
}

describe("resolveAuthenticatedActor", () => {
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
    vi.useRealTimers();
  });

  it("resuelve el actor a partir de una cookie de sesión válida", async () => {
    const { token } = await service.login(ANA.email, "clave-segura-1");
    const actor = await resolveAuthenticatedActor(requestWithCookie(token));
    expect(actor.email).toBe(ANA.email);
    expect(actor.sector).toBe(ANA.sector);
    expect(actor.displayName).toBe(ANA.displayName);
  });

  it("rechaza (401) cuando no hay cookie ni headers de test", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(resolveAuthenticatedActor(requestWithCookie(null))).rejects.toBeInstanceOf(
      AuthUnauthorizedError
    );
  });

  it("rechaza (401) con un token de cookie forjado/inexistente fuera de modo test", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(
      resolveAuthenticatedActor(requestWithCookie("token-completamente-inventado"))
    ).rejects.toBeInstanceOf(AuthUnauthorizedError);
  });

  it("IGNORA el header x-genus-actor-email forjado fuera de modo test (no autentica)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    // Sin GENUS_AUTH_ALLOW_TEST_HEADERS y sin NODE_ENV=test: el header nunca es fuente de identidad.
    await expect(
      resolveAuthenticatedActor(requestWithHeader(ANA.email))
    ).rejects.toBeInstanceOf(AuthUnauthorizedError);
  });

  it("una cookie inválida NO habilita fallback al header, ni siquiera fuera de modo test", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const headers = new Headers();
    headers.set("cookie", `${COOKIE_NAME}=token-invalido`);
    headers.set("x-genus-actor-email", ANA.email);
    const request = new Request("https://example.test/api/v1/orders", { headers });
    await expect(resolveAuthenticatedActor(request)).rejects.toBeInstanceOf(AuthUnauthorizedError);
  });

  it("en vitest la cookie de sesión gana sobre un header forjado de otro usuario", async () => {
    // NODE_ENV=test conserva headers legacy para fixtures, pero una sesión real
    // siempre es la fuente de identidad prioritaria.
    const { token } = await service.login(ANA.email, "clave-segura-1");
    const request = new Request("https://example.test/api/v1/orders", {
      headers: {
        cookie: `${COOKIE_NAME}=${token}`,
        "x-genus-actor-email": CALIDAD.email,
      },
    });

    const actor = await resolveAuthenticatedActor(request);
    expect(actor.email).toBe(ANA.email);
    expect(actor.sector).toBe(ANA.sector);
  });

  it("acepta el header legacy SOLO cuando NODE_ENV==='test' (compat vitest)", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const actor = await resolveAuthenticatedActor(requestWithHeader(ANA.email));
    expect(actor.email).toBe(ANA.email);
    expect(actor.sector).toBe(ANA.sector);
  });

  it("acepta el header legacy cuando GENUS_AUTH_ALLOW_TEST_HEADERS=1 aunque NODE_ENV no sea test", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GENUS_AUTH_ALLOW_TEST_HEADERS", "1");
    const actor = await resolveAuthenticatedActor(requestWithHeader(ANA.email));
    expect(actor.email).toBe(ANA.email);
  });

  it("el header legacy con un email fuera del directorio sigue siendo 401 incluso en modo test", async () => {
    vi.stubEnv("NODE_ENV", "test");
    await expect(
      resolveAuthenticatedActor(requestWithHeader("nadie@laboratoriogenus.com.ar"))
    ).rejects.toBeInstanceOf(AuthUnauthorizedError);
  });

  it("una sesión revocada (logout) deja de autenticar y no cae al header fuera de modo test", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { token } = await service.login(ANA.email, "clave-segura-1");
    await service.logout(token);
    await expect(resolveAuthenticatedActor(requestWithCookie(token))).rejects.toBeInstanceOf(
      AuthUnauthorizedError
    );
  });

  it("una sesión expirada responde 401", async () => {
    const { token } = await service.login(ANA.email, "clave-segura-1");
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31 * 24 * 60 * 60 * 1000);

    await expect(resolveAuthenticatedActor(requestWithCookie(token))).rejects.toBeInstanceOf(
      AuthUnauthorizedError
    );
  });
});
