import { beforeEach, describe, expect, it, vi } from "vitest";
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

const produccion = { "x-genus-actor-email": "produccion@x.com", "x-genus-actor-sector": "PRODUCCION" };
const calidad = { "x-genus-actor-email": "calidad@x.com", "x-genus-actor-sector": "CALIDAD" };

async function post(body: unknown, headers: Record<string, string>) {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost/api/v1/asignacion-lotes/sources/preview-import", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    })
  );
}

describe("POST /api/v1/asignacion-lotes/sources/preview-import", () => {
  beforeEach(() => {
    resetAsignacionLotesMemoryForTests();
    readTabMock.mockReset();
  });

  it("Test 29: RBAC bloquea a un sector operativo", async () => {
    const res = await post({ spreadsheetUrlOrId: "https://docs.google.com/spreadsheets/d/abc123XYZ_-987", sheetTab: "LOTES" }, calidad);
    expect(res.status).toBe(403);
  });

  it("Producción ve la vista previa antes de conectar", async () => {
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "CANTIDAD"],
      ["G25001", "10/01/2025", "SERUM", "50"],
    ]);
    const res = await post(
      { spreadsheetUrlOrId: "https://docs.google.com/spreadsheets/d/abc123XYZ_-987", sheetTab: "LOTES" },
      produccion
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; nuevas: number };
    expect(body.ok).toBe(true);
    expect(body.nuevas).toBe(1);
  });

  it("faltan campos -> 400", async () => {
    const res = await post({ spreadsheetUrlOrId: "https://docs.google.com/spreadsheets/d/abc123XYZ_-987" }, produccion);
    expect(res.status).toBe(400);
  });
});
