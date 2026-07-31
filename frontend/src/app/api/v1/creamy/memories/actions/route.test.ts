import { beforeEach, describe, expect, it } from "vitest";
import { MemoryCreamyMemoryRepository } from "@/lib/creamy-memory/memory-repository";
import { setCreamyMemoryRepositoryForTests, getCreamyMemoryService } from "@/lib/creamy-memory/get-creamy-memory-service";

const ELABORACION_EMAIL = "elaboracion@laboratoriogenus.com.ar";
const CALIDAD_EMAIL = "calidad@laboratoriogenus.com.ar";

function requestFor(body: unknown, email?: string) {
  return new Request("http://localhost/api/v1/creamy/memories/actions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(email ? { "x-genus-actor-email": email } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/creamy/memories/actions", () => {
  let repo: MemoryCreamyMemoryRepository;

  beforeEach(() => {
    repo = new MemoryCreamyMemoryRepository();
    setCreamyMemoryRepositoryForTests(repo);
  });

  it("requiere sesión (x-genus-actor-email)", async () => {
    const { POST } = await import("./route");
    const response = await POST(requestFor({ action: "forget", memoryId: "x" }));
    expect(response.status).toBe(400);
  });

  it("rechaza action inválida o memoryId faltante", async () => {
    const { POST } = await import("./route");
    const invalidAction = await POST(requestFor({ action: "delete", memoryId: "x" }, ELABORACION_EMAIL));
    expect(invalidAction.status).toBe(400);

    const missingId = await POST(requestFor({ action: "forget" }, ELABORACION_EMAIL));
    expect(missingId.status).toBe(400);
  });

  it("valida un hecho operativo solo si el actor es Calidad/Producción/Dirección", async () => {
    const service = getCreamyMemoryService();
    const { memory } = await service.createOperationalMemory(
      { email: ELABORACION_EMAIL, sector: "ELABORACION" },
      {
        client: "Cliente Real",
        product: "Producto Real",
        materiaPrimaOriginal: "MP Original",
        materiaPrimaUtilizada: "MP Usada",
        motivo: "Motivo válido",
      }
    );

    const { POST } = await import("./route");
    const forbidden = await POST(
      requestFor({ action: "validate", memoryId: memory.id }, ELABORACION_EMAIL)
    );
    expect(forbidden.status).toBe(403);

    const ok = await POST(requestFor({ action: "validate", memoryId: memory.id }, CALIDAD_EMAIL));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.memory.estado).toBe("VALIDADA");
  });

  it("forget solo permite al propio usuario olvidar su memoria personal", async () => {
    const service = getCreamyMemoryService();
    const memory = await service.upsertUserMemory(
      { email: ELABORACION_EMAIL, sector: "ELABORACION" },
      { memoryType: "nota", content: "Dato personal de prueba real" }
    );

    const { POST } = await import("./route");
    // Otro usuario pidiendo "forget" de un id que no es suyo: 404 (no revela si existe).
    const notOwner = await POST(requestFor({ action: "forget", memoryId: memory.id }, CALIDAD_EMAIL));
    expect(notOwner.status).toBe(404);

    const ok = await POST(requestFor({ action: "forget", memoryId: memory.id }, ELABORACION_EMAIL));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.memory.status).toBe("deleted");
  });
});
