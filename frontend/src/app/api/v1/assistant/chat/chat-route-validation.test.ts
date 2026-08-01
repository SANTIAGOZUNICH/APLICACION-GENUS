import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "@/lib/auth/cookies";
import { SECTOR_ACCOUNT_DIRECTORY } from "@/lib/auth/directory";
import { setAuthRepositoryForTests } from "@/lib/auth/get-auth-service";
import { MemoryAuthRepository } from "@/lib/auth/memory-repository";
import { AuthService } from "@/lib/auth/service";
import { validateChatRequestBody, sanitizeUiContext } from "./route";

const PRODUCCION = SECTOR_ACCOUNT_DIRECTORY.find((entry) => entry.sector === "PRODUCCION")!;

function chatRequest(body: unknown, headers?: Record<string, string>): Request {
  return new Request("https://example.test/api/v1/assistant/chat", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("assistant chat route validation", () => {
  let service: AuthService;

  beforeEach(async () => {
    const repo = new MemoryAuthRepository();
    service = new AuthService(repo);
    setAuthRepositoryForTests(repo);
    await service.ensureUsersSeeded({ [PRODUCCION.email]: "clave-produccion-1" });
  });

  afterEach(() => {
    setAuthRepositoryForTests(null);
    vi.unstubAllEnvs();
  });

  it("rechaza actorSectorId faltante", () => {
    const result = validateChatRequestBody({
      messages: [{ role: "user", content: "Hola" }],
    });
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      code: "ACTOR_SECTOR_REQUIRED",
    });
  });

  it("rechaza mensajes vacíos", () => {
    const result = validateChatRequestBody({
      actorSectorId: "PRODUCCION",
      messages: [],
    });
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      code: "MESSAGES_REQUIRED",
    });
  });

  it("rechaza último mensaje de usuario vacío", () => {
    const result = validateChatRequestBody({
      actorSectorId: "PRODUCCION",
      messages: [{ role: "user", content: "   " }],
    });
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      code: "LAST_USER_MESSAGE_REQUIRED",
    });
  });

  it("rechaza mensajes demasiado largos", () => {
    const result = validateChatRequestBody({
      actorSectorId: "PRODUCCION",
      messages: [{ role: "user", content: "x".repeat(4001) }],
    });
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      code: "MESSAGE_TOO_LONG",
    });
  });

  it("normaliza actorSectorId y recorta historial a 12 mensajes", () => {
    const messages = Array.from({ length: 25 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `mensaje ${index}`,
    }));
    messages[24] = { role: "user", content: "última pregunta" };

    const result = validateChatRequestBody({
      actorSectorId: " produccion ",
      messages,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.actorSectorId).toBe("PRODUCCION");
      expect(result.value.messages).toHaveLength(12);
      expect(result.value.messages.at(-1)?.content).toBe("última pregunta");
    }
  });

  it("acepta uiContext válido y recorta campos", () => {
    const result = validateChatRequestBody({
      actorSectorId: "PRODUCCION",
      messages: [{ role: "user", content: "Hola" }],
      uiContext: {
        email: "prod@example.com",
        route: "produccion",
        tab: "remitos",
        moduleName: "Producción",
        availableNav: ["remitos", "ordenes_elaboracion"],
        openItemSummary: "OE-123",
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.uiContext).toMatchObject({
        email: "prod@example.com",
        route: "produccion",
        availableNav: ["remitos", "ordenes_elaboracion"],
      });
    }
  });

  it("rechaza uiContext con claves sensibles", () => {
    expect(
      sanitizeUiContext({
        email: "a@b.com",
        password: "secret",
      })
    ).toBeUndefined();
  });

  it("requiere sesión para Creamy e ignora x-genus-actor-email fuera de modo test", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GENUS_AUTH_ALLOW_TEST_HEADERS", "");
    const { POST } = await import("./route");

    const response = await POST(
      chatRequest(
        {
          actorSectorId: PRODUCCION.sector,
          messages: [{ role: "user", content: "Hola Creamy" }],
        },
        { "x-genus-actor-email": PRODUCCION.email }
      )
    );

    expect(response.status).toBe(401);
  });

  it("no permite que el body suplante el sector autenticado de Creamy", async () => {
    const { token } = await service.login(PRODUCCION.email, "clave-produccion-1");
    const { POST } = await import("./route");

    const response = await POST(
      chatRequest(
        {
          actorSectorId: "CALIDAD",
          messages: [{ role: "user", content: "Hola Creamy" }],
          uiContext: { email: "calidad@laboratoriogenus.com.ar" },
        },
        { cookie: `${COOKIE_NAME}=${token}` }
      )
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "ACTOR_SECTOR_MISMATCH" });
  });
});
