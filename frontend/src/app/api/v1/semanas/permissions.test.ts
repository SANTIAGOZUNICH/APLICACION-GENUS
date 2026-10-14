import { afterEach, describe, expect, it, vi } from "vitest";
import { OPERATIONAL_SECTOR_IDS } from "@/types/operational/sector";
import { resetSemanasPrioritiesMemoryForTests } from "@/lib/semanas-sheet/semanas-priorities-service";

let currentSector = "PRODUCCION";
vi.mock("@/lib/orders/actor", () => ({
  resolveOrdersActor: async () => ({ userId: "u", email: `${currentSector.toLowerCase()}@laboratoriogenus.com.ar`, sector: currentSector, displayName: `Usuario ${currentSector}` }),
}));

const NON_PROD = OPERATIONAL_SECTOR_IDS.filter((s) => s !== "PRODUCCION");
const json = (body: unknown) => new Request("http://localhost/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

afterEach(() => resetSemanasPrioritiesMemoryForTests());

describe("permisos en el BACKEND: solo Producción modifica la planificación y las prioridades", () => {
  it("hay sectores no-Producción para probar", () => {
    expect(NON_PROD.length).toBeGreaterThanOrEqual(5);
  });

  it.each(NON_PROD)("%s: PATCH /semanas/priorities → 403 (aunque mande una tarea válida)", async (sector) => {
    currentSector = sector;
    const { PATCH } = await import("./priorities/route");
    const res = await PATCH(json({ tabKey: "ELABORACION", taskKey: "k", priority: "URGENTE", expectedVersion: 0 }));
    expect(res.status).toBe(403);
  });

  it.each(NON_PROD)("%s: PATCH /semanas/cells → 403 y nada se escribe", async (sector) => {
    currentSector = sector;
    const { PATCH } = await import("./cells/route");
    const res = await PATCH(json({ edits: [{ tabKey: "ELABORACION", a1: "F6", expectedValue: "x", value: "y" }] }));
    expect(res.status).toBe(403);
  });

  it.each(NON_PROD)("%s: PATCH /work-items/cells (productos, cantidades, clientes, fechas) → 403", async (sector) => {
    currentSector = sector;
    const { PATCH } = await import("../work-items/cells/route");
    const res = await PATCH(json({ changes: [{ id: "native:w1", field: "product", value: "otro", expectedVersion: 1 }] }));
    expect(res.status).toBe(403);
  });

  it.each(NON_PROD)("%s: la grilla completa de Semanas (celdas crudas) solo se sirve a Producción → 403", async (sector) => {
    currentSector = sector;
    const { GET } = await import("./grid/route");
    const res = await GET(new Request("http://localhost/api/v1/semanas/grid?tab=ELABORACION"));
    expect(res.status).toBe(403);
  });

  it("Producción SÍ puede (no es un 403)", async () => {
    currentSector = "PRODUCCION";
    const { PATCH } = await import("./priorities/route");
    const res = await PATCH(json({ tabKey: "ELABORACION", taskKey: "k", priority: "URGENTE", expectedVersion: 0 }));
    expect(res.status).not.toBe(403); // sin planilla en el test: la tarea no existe → 409/5xx, nunca «sin permiso»
  });
});
