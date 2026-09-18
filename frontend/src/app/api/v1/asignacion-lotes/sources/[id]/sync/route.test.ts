import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAsignacionLoteSourcesService, resetAsignacionLoteSourcesMemoryForTests } from "@/lib/asignacion-lotes/asignacion-lote-sources-service";
import { resetAsignacionLotesMemoryForTests } from "@/lib/asignacion-lotes/asignacion-lotes-service";
import { OrdersValidationError } from "@/lib/orders/types";

const readTabMock = vi.fn();
vi.mock("@/lib/adapters/sheets/sheets-reader", () => ({
  sheetsReader: { readTab: (...args: unknown[]) => readTabMock(...args), listTabs: vi.fn() },
}));

vi.mock("@/lib/orders/actor", () => ({
  resolveOrdersActor: (request: Request) => {
    const email = request.headers.get("x-genus-actor-email");
    const sector = (request.headers.get("x-genus-actor-sector") || "PRODUCCION").toUpperCase();
    if (!email) throw new OrdersValidationError("Sesión requerida.");
    return { email, sector, displayName: "Test" };
  },
}));

const produccion = { email: "produccion@x.com", sector: "PRODUCCION" as const, displayName: "Producción" };

describe("POST /api/v1/asignacion-lotes/sources/[id]/sync — Test 23: Sincronizar ahora", () => {
  beforeEach(() => {
    resetAsignacionLoteSourcesMemoryForTests();
    resetAsignacionLotesMemoryForTests();
    readTabMock.mockReset();
  });

  it("dispara la sincronización manual y devuelve el resumen de la corrida", async () => {
    const source = await getAsignacionLoteSourcesService().create(produccion, {
      name: "2026",
      period: "2026",
      spreadsheetUrlOrId: "https://docs.google.com/spreadsheets/d/abc123XYZ_-987",
      sheetTab: "LOTES",
    });
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "CANTIDAD"],
      ["G26043", "10/09/2026", "SERUM", "100"],
    ]);
    const { POST } = await import("./route");
    const res = await POST(
      new Request(`http://localhost/api/v1/asignacion-lotes/sources/${source.id}/sync`, {
        method: "POST",
        headers: { "x-genus-actor-email": "produccion@x.com", "x-genus-actor-sector": "PRODUCCION" },
      }),
      { params: Promise.resolve({ id: source.id }) }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: { createdCount: number; triggerKind: string } };
    expect(body.run.createdCount).toBe(1);
    expect(body.run.triggerKind).toBe("manual");
  });

  it("fuente inexistente -> 404", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/v1/asignacion-lotes/sources/no-existe/sync", {
        method: "POST",
        headers: { "x-genus-actor-email": "produccion@x.com", "x-genus-actor-sector": "PRODUCCION" },
      }),
      { params: Promise.resolve({ id: "no-existe" }) }
    );
    expect(res.status).toBe(404);
  });

  it("sector operativo sin permiso de configuración -> 403", async () => {
    const source = await getAsignacionLoteSourcesService().create(produccion, {
      name: "2026",
      period: "2026",
      spreadsheetUrlOrId: "https://docs.google.com/spreadsheets/d/abc123XYZ_-987",
      sheetTab: "LOTES",
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request(`http://localhost/api/v1/asignacion-lotes/sources/${source.id}/sync`, {
        method: "POST",
        headers: { "x-genus-actor-email": "calidad@x.com", "x-genus-actor-sector": "CALIDAD" },
      }),
      { params: Promise.resolve({ id: source.id }) }
    );
    expect(res.status).toBe(403);
  });
});
