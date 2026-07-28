import { describe, expect, it, vi, beforeEach } from "vitest";
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

describe("asignacion-lotes API", () => {
  beforeEach(() => {
    resetAsignacionLotesMemoryForTests();
  });

  const calidadHeaders = {
    "Content-Type": "application/json",
    "x-genus-actor-email": "calidad@laboratoriogenus.com.ar",
    "x-genus-actor-sector": "CALIDAD",
  };

  const elaboracionHeaders = {
    "Content-Type": "application/json",
    "x-genus-actor-email": "elaboracion@laboratoriogenus.com.ar",
    "x-genus-actor-sector": "ELABORACION",
  };

  it("GET lista para sector autorizado", async () => {
    const { GET } = await import("@/app/api/v1/asignacion-lotes/route");
    const res = await GET(
      new Request("http://localhost/api/v1/asignacion-lotes", { headers: calidadHeaders })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it("403 sector no autorizado en GET", async () => {
    const { GET } = await import("@/app/api/v1/asignacion-lotes/route");
    const res = await GET(
      new Request("http://localhost/api/v1/asignacion-lotes", { headers: elaboracionHeaders })
    );
    expect(res.status).toBe(403);
  });

  it("403 cuando body.actorSectorId no coincide con header en POST", async () => {
    const { POST } = await import("@/app/api/v1/asignacion-lotes/route");
    const res = await POST(
      new Request("http://localhost/api/v1/asignacion-lotes", {
        method: "POST",
        headers: calidadHeaders,
        body: JSON.stringify({
          action: "upsert",
          actorSectorId: "PRODUCCION",
          record: {
            lote: "L-TEST",
            fecha: "2026-07-28",
            producto: "Test",
            codigo: "T-1",
            cantidades: 10,
            updatedBy: "Test",
          },
        }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("archive y restore autorizados vía PATCH", async () => {
    const svc = getAsignacionLotesService();
    const created = svc.upsert(
      { email: "calidad@laboratoriogenus.com.ar", sector: "CALIDAD", displayName: "Calidad" },
      {
        lote: "L-ARC",
        fecha: "2026-07-28",
        producto: "Shampoo",
        codigo: "SH-01",
        cantidades: 100,
        updatedBy: "Calidad",
      }
    );

    const { PATCH } = await import("@/app/api/v1/asignacion-lotes/[id]/route");

    const archiveRes = await PATCH(
      new Request(`http://localhost/api/v1/asignacion-lotes/${created.id}`, {
        method: "PATCH",
        headers: calidadHeaders,
        body: JSON.stringify({
          lifecycleAction: "archive",
          actorSectorId: "CALIDAD",
        }),
      }),
      { params: Promise.resolve({ id: created.id }) }
    );
    expect(archiveRes.status).toBe(200);
    const archived = (await archiveRes.json()) as { item: { archived?: boolean } };
    expect(archived.item.archived).toBe(true);

    const restoreRes = await PATCH(
      new Request(`http://localhost/api/v1/asignacion-lotes/${created.id}`, {
        method: "PATCH",
        headers: calidadHeaders,
        body: JSON.stringify({
          lifecycleAction: "restore",
          actorSectorId: "CALIDAD",
        }),
      }),
      { params: Promise.resolve({ id: created.id }) }
    );
    expect(restoreRes.status).toBe(200);
    const restored = (await restoreRes.json()) as { item: { archived?: boolean } };
    expect(restored.item.archived).toBe(false);
  });

  it("403 archive para sector no autorizado", async () => {
    const svc = getAsignacionLotesService();
    const created = svc.upsert(
      { email: "calidad@laboratoriogenus.com.ar", sector: "CALIDAD", displayName: "Calidad" },
      {
        lote: "L-DENY",
        fecha: "2026-07-28",
        producto: "Crema",
        codigo: "CR-01",
        cantidades: 50,
        updatedBy: "Calidad",
      }
    );

    const { PATCH } = await import("@/app/api/v1/asignacion-lotes/[id]/route");
    const res = await PATCH(
      new Request(`http://localhost/api/v1/asignacion-lotes/${created.id}`, {
        method: "PATCH",
        headers: elaboracionHeaders,
        body: JSON.stringify({ lifecycleAction: "archive", actorSectorId: "ELABORACION" }),
      }),
      { params: Promise.resolve({ id: created.id }) }
    );
    expect(res.status).toBe(403);
  });
});
