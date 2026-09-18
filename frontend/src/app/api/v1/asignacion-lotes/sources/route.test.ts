import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAsignacionLoteSourcesMemoryForTests } from "@/lib/asignacion-lotes/asignacion-lote-sources-service";
import { OrdersValidationError } from "@/lib/orders/types";

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
    new Request("http://localhost/api/v1/asignacion-lotes/sources", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    })
  );
}

async function get(headers: Record<string, string>) {
  const { GET } = await import("./route");
  return GET(new Request("http://localhost/api/v1/asignacion-lotes/sources", { headers }));
}

describe("POST/GET /api/v1/asignacion-lotes/sources", () => {
  beforeEach(() => {
    resetAsignacionLoteSourcesMemoryForTests();
  });

  it("Test 29: RBAC bloquea a un sector operativo (Calidad solo consume, no configura)", async () => {
    const res = await post(
      { name: "2026", period: "2026", spreadsheetUrlOrId: "https://docs.google.com/spreadsheets/d/abc123XYZ_-987", sheetTab: "LOTES" },
      calidad
    );
    expect(res.status).toBe(403);
  });

  it("Producción conecta una planilla nueva sin deploy — queda disponible de inmediato en el listado", async () => {
    const created = await post(
      { name: "Asignación de Lotes 2027", period: "2027", spreadsheetUrlOrId: "https://docs.google.com/spreadsheets/d/zzz999AAA_-111", sheetTab: "LOTES" },
      produccion
    );
    expect(created.status).toBe(201);
    const listRes = await get(produccion);
    const body = (await listRes.json()) as { sources: Array<{ name: string }> };
    expect(body.sources.map((s) => s.name)).toContain("Asignación de Lotes 2027");
  });

  it("URL faltante -> 400", async () => {
    const res = await post({ name: "X", period: "2026", sheetTab: "LOTES" }, produccion);
    expect(res.status).toBe(400);
  });

  it("Hotfix — sheetTab omitido ya no es obligatorio (hoja opcional, sección 5)", async () => {
    const created = await post(
      { name: "Asignación de Lotes 2025", period: "2025", spreadsheetUrlOrId: "https://docs.google.com/spreadsheets/d/hist2025AAAA_-111" },
      produccion
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as { source: { sheetTab: string | null } };
    expect(body.source.sheetTab).toBeNull();
  });
});
