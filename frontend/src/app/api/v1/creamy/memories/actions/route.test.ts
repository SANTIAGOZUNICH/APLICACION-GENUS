import { beforeEach, describe, expect, it } from "vitest";
import { COOKIE_NAME } from "@/lib/auth/cookies";
import { SECTOR_ACCOUNT_DIRECTORY } from "@/lib/auth/directory";
import { setAuthRepositoryForTests } from "@/lib/auth/get-auth-service";
import { MemoryAuthRepository } from "@/lib/auth/memory-repository";
import { AuthService } from "@/lib/auth/service";
import { MemoryCreamyMemoryRepository } from "@/lib/creamy-memory/memory-repository";
import { setCreamyMemoryRepositoryForTests, getCreamyMemoryService } from "@/lib/creamy-memory/get-creamy-memory-service";

const PRODUCCION = SECTOR_ACCOUNT_DIRECTORY.find((entry) => entry.sector === "PRODUCCION")!;
const CALIDAD = SECTOR_ACCOUNT_DIRECTORY.find((entry) => entry.sector === "CALIDAD")!;

function requestFor(body: unknown, token?: string) {
  return new Request("http://localhost/api/v1/creamy/memories/actions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { cookie: `${COOKIE_NAME}=${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/creamy/memories/actions", () => {
  let repo: MemoryCreamyMemoryRepository;
  let authService: AuthService;
  let produccionToken: string;
  let calidadToken: string;

  beforeEach(async () => {
    repo = new MemoryCreamyMemoryRepository();
    setCreamyMemoryRepositoryForTests(repo);
    const authRepo = new MemoryAuthRepository();
    authService = new AuthService(authRepo);
    setAuthRepositoryForTests(authRepo);
    await authService.ensureUsersSeeded({
      [PRODUCCION.email]: "clave-produccion-1",
      [CALIDAD.email]: "clave-calidad-1",
    });
    produccionToken = (await authService.login(PRODUCCION.email, "clave-produccion-1")).token;
    calidadToken = (await authService.login(CALIDAD.email, "clave-calidad-1")).token;
  });

  it("requiere sesión para las acciones de memoria de Creamy", async () => {
    const { POST } = await import("./route");
    const response = await POST(requestFor({ action: "forget", memoryId: "x" }));
    expect(response.status).toBe(401);
  });

  it("rechaza action inválida o memoryId faltante", async () => {
    const { POST } = await import("./route");
    const invalidAction = await POST(requestFor({ action: "delete", memoryId: "x" }, produccionToken));
    expect(invalidAction.status).toBe(400);

    const missingId = await POST(requestFor({ action: "forget" }, produccionToken));
    expect(missingId.status).toBe(400);
  });

  it("valida un hecho operativo solo si el actor es Calidad/Producción/Dirección", async () => {
    const service = getCreamyMemoryService();
    const { memory } = await service.createOperationalMemory(
      { email: PRODUCCION.email, sector: PRODUCCION.sector },
      {
        client: "Cliente Real",
        product: "Producto Real",
        materiaPrimaOriginal: "MP Original",
        materiaPrimaUtilizada: "MP Usada",
        motivo: "Motivo válido",
      }
    );

    const { POST } = await import("./route");
    const ok = await POST(requestFor({ action: "validate", memoryId: memory.id }, calidadToken));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.memory.estado).toBe("VALIDADA");
  });

  it("forget solo permite al propio usuario olvidar su memoria personal", async () => {
    const service = getCreamyMemoryService();
    const memory = await service.upsertUserMemory(
      { email: PRODUCCION.email, sector: PRODUCCION.sector },
      { memoryType: "nota", content: "Dato personal de prueba real" }
    );

    const { POST } = await import("./route");
    // Otro usuario pidiendo "forget" de un id que no es suyo: 404 (no revela si existe).
    const notOwner = await POST(requestFor({ action: "forget", memoryId: memory.id }, calidadToken));
    expect(notOwner.status).toBe(404);

    const ok = await POST(requestFor({ action: "forget", memoryId: memory.id }, produccionToken));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.memory.status).toBe("deleted");
  });

  it("mantiene separadas las memorias personales de Producción y Calidad", async () => {
    const service = getCreamyMemoryService();
    await service.upsertUserMemory(
      { email: PRODUCCION.email, sector: PRODUCCION.sector },
      { memoryType: "nota", content: "Preferencia de Producción" }
    );
    await service.upsertUserMemory(
      { email: CALIDAD.email, sector: CALIDAD.sector },
      { memoryType: "nota", content: "Preferencia de Calidad" }
    );

    const produccion = await service.listUserMemories(
      { email: PRODUCCION.email, sector: PRODUCCION.sector },
      PRODUCCION.email
    );
    const calidad = await service.listUserMemories(
      { email: CALIDAD.email, sector: CALIDAD.sector },
      CALIDAD.email
    );

    expect(produccion.map((memory) => memory.content)).toEqual(["Preferencia de Producción"]);
    expect(calidad.map((memory) => memory.content)).toEqual(["Preferencia de Calidad"]);
  });
});
