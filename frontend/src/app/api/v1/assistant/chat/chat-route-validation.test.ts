import { describe, expect, it } from "vitest";
import { validateChatRequestBody } from "./route";

describe("assistant chat route validation", () => {
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

  it("normaliza actorSectorId y recorta historial a 20 mensajes", () => {
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
      expect(result.value.messages).toHaveLength(20);
      expect(result.value.messages.at(-1)?.content).toBe("última pregunta");
    }
  });
});
