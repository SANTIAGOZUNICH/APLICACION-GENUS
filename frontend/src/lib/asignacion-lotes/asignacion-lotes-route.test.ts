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

  it("DELETE elimina asignación con motivo opcional", async () => {
    const svc = getAsignacionLotesService();
    const created = await svc.upsert(
      { email: "calidad@laboratoriogenus.com.ar", sector: "CALIDAD", displayName: "Calidad" },
      {
        lote: "L-DEL",
        fecha: "2026-07-28",
        producto: "Shampoo",
        codigo: "SH-01",
        cantidades: 100,
        updatedBy: "Calidad",
      }
    );

    const { DELETE } = await import("@/app/api/v1/asignacion-lotes/[id]/route");

    const deleteRes = await DELETE(
      new Request(`http://localhost/api/v1/asignacion-lotes/${created.id}`, {
        method: "DELETE",
        headers: calidadHeaders,
        body: JSON.stringify({
          actorSectorId: "CALIDAD",
          reason: "  ",
        }),
      }),
      { params: Promise.resolve({ id: created.id }) }
    );
    expect(deleteRes.status).toBe(200);
    expect(await svc.get(
      { email: "calidad@laboratoriogenus.com.ar", sector: "CALIDAD", displayName: "Calidad" },
      created.id
    )).toBeNull();
  });

  it("403 DELETE para sector no autorizado", async () => {
    const svc = getAsignacionLotesService();
    const created = await svc.upsert(
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

    const { DELETE } = await import("@/app/api/v1/asignacion-lotes/[id]/route");
    const res = await DELETE(
      new Request(`http://localhost/api/v1/asignacion-lotes/${created.id}`, {
        method: "DELETE",
        headers: elaboracionHeaders,
        body: JSON.stringify({ actorSectorId: "ELABORACION" }),
      }),
      { params: Promise.resolve({ id: created.id }) }
    );
    expect(res.status).toBe(403);
  });
});

describe("asignacion-lotes API — diagnóstico de Production (bug post PR #112)", () => {
  const prodHeaders = {
    "Content-Type": "application/json",
    "x-genus-actor-email": "produccion@laboratoriogenus.com.ar",
    "x-genus-actor-sector": "PRODUCCION",
  };
  const missingColumn = () =>
    Object.assign(new Error("Failed query: select …"), {
      cause: Object.assign(new Error('column "source_lote" does not exist'), { code: "42703" }),
    });

  it("GET informa el commit desplegado para detectar pestañas con una versión anterior", async () => {
    const prev = process.env.VERCEL_GIT_COMMIT_SHA;
    process.env.VERCEL_GIT_COMMIT_SHA = "feedbeef1234";
    try {
      const { GET } = await import("@/app/api/v1/asignacion-lotes/route");
      const res = await GET(new Request("http://localhost/api/v1/asignacion-lotes", { headers: prodHeaders }));
      const body = (await res.json()) as { build: string; localEditsReady: boolean };
      expect(res.status).toBe(200);
      expect(body.build).toBe("feedbeef1234");
      expect(typeof body.localEditsReady).toBe("boolean");
    } finally {
      if (prev === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
      else process.env.VERCEL_GIT_COMMIT_SHA = prev;
    }
  });

  it("base sin 0043: GET y PATCH responden 503 ASIGNACION_LOTES_SCHEMA_PENDING (antes 500 genérico)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const svc = getAsignacionLotesService();
    const list = vi.spyOn(svc, "list").mockRejectedValueOnce(missingColumn());
    const get = vi.spyOn(svc, "get").mockRejectedValueOnce(missingColumn());
    const { GET } = await import("@/app/api/v1/asignacion-lotes/route");
    const res = await GET(new Request("http://localhost/api/v1/asignacion-lotes", { headers: prodHeaders }));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe("ASIGNACION_LOTES_SCHEMA_PENDING");

    const { PATCH } = await import("@/app/api/v1/asignacion-lotes/cells/route");
    const patch = await PATCH(
      new Request("http://localhost/api/v1/asignacion-lotes/cells", {
        method: "PATCH",
        headers: prodHeaders,
        body: JSON.stringify({ changes: [{ id: "x", field: "cantidades", value: "1", expectedVersion: "v" }] }),
      })
    );
    expect(patch.status).toBe(503);
    const body = (await patch.json()) as { code: string; error: string };
    expect(body.code).toBe("ASIGNACION_LOTES_SCHEMA_PENDING");
    expect(body.error).toMatch(/0043/);
    list.mockRestore();
    get.mockRestore();
    vi.restoreAllMocks();
  });
});
