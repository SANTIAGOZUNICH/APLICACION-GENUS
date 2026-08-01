import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "@/lib/auth/cookies";
import { SECTOR_ACCOUNT_DIRECTORY } from "@/lib/auth/directory";
import { setAuthRepositoryForTests } from "@/lib/auth/get-auth-service";
import { MemoryAuthRepository } from "@/lib/auth/memory-repository";
import { AuthService } from "@/lib/auth/service";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";

const ANA = SECTOR_ACCOUNT_DIRECTORY[0]; // ELABORACION

function requestWithCookie(token: string | null, extraHeaders?: Record<string, string>): Request {
  const headers = new Headers(extraHeaders);
  if (token) headers.set("cookie", `${COOKIE_NAME}=${token}`);
  return new Request("https://example.test/api/v1/orders", { headers });
}

describe("resolveOrdersActor", () => {
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

  it("resuelve el OrdersActor desde una cookie de sesión válida", async () => {
    const { token } = await service.login(ANA.email, "clave-segura-1");
    const actor = await resolveOrdersActor(requestWithCookie(token));
    expect(actor).toMatchObject({
      userId: expect.any(String),
      email: ANA.email,
      sector: ANA.sector,
      displayName: ANA.displayName,
    });
  });

  it("sin sesión lanza OrdersValidationError (401-ish)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(resolveOrdersActor(requestWithCookie(null))).rejects.toBeInstanceOf(
      OrdersValidationError
    );
  });

  it("un header x-genus-actor-email forjado NO autentica fuera de modo test", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = requestWithCookie(null, { "x-genus-actor-email": ANA.email });
    await expect(resolveOrdersActor(request)).rejects.toBeInstanceOf(OrdersValidationError);
  });

  it("un x-genus-actor-sector que no coincide con la sesión lanza OrdersForbiddenError", async () => {
    const { token } = await service.login(ANA.email, "clave-segura-1");
    const request = requestWithCookie(token, { "x-genus-actor-sector": "CALIDAD" });
    await expect(resolveOrdersActor(request)).rejects.toBeInstanceOf(OrdersForbiddenError);
  });
});
