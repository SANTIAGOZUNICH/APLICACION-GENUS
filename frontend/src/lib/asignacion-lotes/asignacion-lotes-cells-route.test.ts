import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAsignacionLotesService,
  resetAsignacionLotesMemoryForTests,
} from "@/lib/asignacion-lotes/asignacion-lotes-service";

vi.mock("@/lib/orders/actor", () => ({
  resolveOrdersActor: (request: Request) => {
    const email = request.headers.get("x-genus-actor-email");
    const sector = (request.headers.get("x-genus-actor-sector") || "PRODUCCION").toUpperCase();
    if (!email) throw new Error("Sesión requerida (header x-genus-actor-email).");
    return { email, sector, displayName: "Test Actor" };
  },
}));

const produccionActor = { email: "p@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "P" };
const headers = (sector: string) => ({
  "Content-Type": "application/json",
  "x-genus-actor-email": `${sector.toLowerCase()}@laboratoriogenus.com.ar`,
  "x-genus-actor-sector": sector,
});

async function patch(body: unknown, sector = "PRODUCCION") {
  const { PATCH } = await import("@/app/api/v1/asignacion-lotes/cells/route");
  return PATCH(
    new Request("http://localhost/api/v1/asignacion-lotes/cells", {
      method: "PATCH",
      headers: headers(sector),
      body: JSON.stringify(body),
    })
  );
}

describe("PATCH /api/v1/asignacion-lotes/cells", () => {
  beforeEach(() => resetAsignacionLotesMemoryForTests());

  async function seed() {
    return getAsignacionLotesService().upsert(produccionActor, {
      lote: "S26001",
      fecha: "2026-05-04",
      producto: "SHAMPOO",
      codigo: "SH-1",
      marca: "KORIDERM",
      cantidades: 6800,
      vto: "2028-05-31",
      updatedBy: "P",
    });
  }

  it("200: guarda la celda y devuelve el registro con nueva versión", async () => {
    const row = await seed();
    const res = await patch({
      actorSectorId: "PRODUCCION",
      changes: [{ id: row.id, field: "cantidades", value: "7000", expectedVersion: row.updatedAt }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; changedCells: number; items: { cantidades: number; vto: string; updatedAt: string }[] };
    expect(body.ok).toBe(true);
    expect(body.changedCells).toBe(1);
    expect(body.items[0]!.cantidades).toBe(7000);
    expect(body.items[0]!.vto).toBe("2028-05-31");
    expect(body.items[0]!.updatedAt).not.toBe(row.updatedAt);
  });

  it("409: versión desactualizada → conflicto con detalle por celda", async () => {
    const row = await seed();
    await patch({ changes: [{ id: row.id, field: "cantidades", value: "7000", expectedVersion: row.updatedAt }] });
    const res = await patch({ changes: [{ id: row.id, field: "cantidades", value: "9", expectedVersion: row.updatedAt }] });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { failures: { code: string }[] };
    expect(body.failures[0]!.code).toBe("CONFLICT");
  });

  it("400: valor inválido; 403: sector sin acceso / columna de otro sector / registro de Google", async () => {
    const row = await seed();
    const bad = await patch({ changes: [{ id: row.id, field: "cantidades", value: "x", expectedVersion: row.updatedAt }] });
    expect(bad.status).toBe(400);

    const otherSector = await patch(
      { changes: [{ id: row.id, field: "cantidades", value: "1", expectedVersion: row.updatedAt }] },
      "ELABORACION"
    );
    expect(otherSector.status).toBe(403);

    const forbiddenField = await patch({ changes: [{ id: row.id, field: "muestras", value: "2", expectedVersion: row.updatedAt }] });
    expect(forbiddenField.status).toBe(403);

    const { record } = await getAsignacionLotesService().upsertFromSource(
      "src-1",
      { email: "sync", displayName: "Sync" },
      { lote: "G1", fecha: "2026-08-01", producto: "X", codigo: "", cantidades: 1, updatedBy: "Sync" },
      "AGOSTO"
    );
    const google = await patch({ changes: [{ id: record.id, field: "cantidades", value: "5", expectedVersion: record.updatedAt }] });
    expect(google.status).toBe(403);
    expect(((await google.json()) as { failures: { code: string }[] }).failures[0]!.code).toBe("PROTECTED_SOURCE");
  });

  it("400 sin changes; 403 si actorSectorId no coincide con la sesión", async () => {
    expect((await patch({})).status).toBe(400);
    expect((await patch({ actorSectorId: "CALIDAD", changes: [] })).status).toBe(403);
  });
});
