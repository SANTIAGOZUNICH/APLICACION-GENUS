import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAsignacionLotesService,
  resetAsignacionLotesMemoryForTests,
} from "@/lib/asignacion-lotes/asignacion-lotes-service";

vi.mock("@/lib/orders/actor", () => ({
  resolveOrdersActor: (request: Request) => {
    const email = request.headers.get("x-genus-actor-email");
    const sector = (request.headers.get("x-genus-actor-sector") || "PRODUCCION").toUpperCase();
    if (!email) {
      const { OrdersValidationError } = require("@/lib/orders/types");
      throw new OrdersValidationError("Sesión requerida.");
    }
    return { email, sector, displayName: "Producción Test" };
  },
}));

async function get(query: string, headers: Record<string, string>) {
  const { GET } = await import("./route");
  return GET(
    new Request(`http://localhost/api/v1/asignacion-lotes/resolve?${query}`, { headers })
  );
}

const produccionHeaders = {
  "x-genus-actor-email": "produccion@laboratoriogenus.com.ar",
  "x-genus-actor-sector": "PRODUCCION",
};

describe("GET /api/v1/asignacion-lotes/resolve", () => {
  beforeEach(() => {
    resetAsignacionLotesMemoryForTests();
  });

  it("403 si el actor no tiene acceso a Asignación de Lotes", async () => {
    const res = await get("cliente=NIZA&producto=SERUM", {
      "x-genus-actor-email": "elaboracion@laboratoriogenus.com.ar",
      "x-genus-actor-sector": "ELABORACION",
    });
    expect(res.status).toBe(403);
  });

  it("sin cliente/producto -> status 'none' sin error", async () => {
    const res = await get("", produccionHeaders);
    const body = (await res.json()) as { status: string };
    expect(res.status).toBe(200);
    expect(body.status).toBe("none");
  });

  it("una única coincidencia -> found con lote/vto", async () => {
    await getAsignacionLotesService().upsert(
      { email: "calidad@test.com", sector: "CALIDAD", displayName: "Calidad" },
      {
        lote: "G26043",
        fecha: "2026-09-10",
        producto: "SERUM NIACINAMIDA",
        codigo: "ABC",
        marca: "NIZA",
        cantidades: 1200,
        vto: "2028-10-31",
        updatedBy: "Calidad",
      }
    );
    const res = await get(
      `cliente=${encodeURIComponent("NIZA")}&producto=${encodeURIComponent("SERUM NIACINAMIDA")}`,
      produccionHeaders
    );
    const body = (await res.json()) as { status: string; candidate?: { lote: string; vto: string } };
    expect(body.status).toBe("found");
    expect(body.candidate?.lote).toBe("G26043");
    expect(body.candidate?.vto).toBe("2028-10-31");
  });

  it("dos coincidencias -> ambiguous con ambos candidatos", async () => {
    const svc = getAsignacionLotesService();
    const actor = { email: "calidad@test.com", sector: "CALIDAD" as const, displayName: "Calidad" };
    await svc.upsert(actor, {
      lote: "G26043",
      fecha: "2026-09-10",
      producto: "SERUM NIACINAMIDA",
      codigo: "ABC",
      marca: "NIZA",
      cantidades: 1200,
      vto: "2028-10-31",
      updatedBy: "Calidad",
    });
    await svc.upsert(actor, {
      lote: "G26044",
      fecha: "2026-09-11",
      producto: "SERUM NIACINAMIDA",
      codigo: "ABC",
      marca: "NIZA",
      cantidades: 1200,
      vto: "2028-11-30",
      updatedBy: "Calidad",
    });
    const res = await get(
      `cliente=${encodeURIComponent("NIZA")}&producto=${encodeURIComponent("SERUM NIACINAMIDA")}`,
      produccionHeaders
    );
    const body = (await res.json()) as { status: string; candidates?: unknown[] };
    expect(body.status).toBe("ambiguous");
    expect(body.candidates).toHaveLength(2);
  });
});
