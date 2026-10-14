import { beforeEach, describe, expect, it, vi } from "vitest";
import { OPERATIONAL_SECTOR_IDS } from "@/types/operational/sector";

vi.mock("@/lib/db/client", () => ({
  isDatabaseConfigured: () => false,
  getDb: () => {
    throw new Error("sin base en este test");
  },
}));

vi.mock("@/lib/orders/actor", () => ({
  resolveOrdersActor: (request: Request) => {
    const sector = request.headers.get("x-test-sector") ?? "PRODUCCION";
    return Promise.resolve({ email: `${sector.toLowerCase()}@test.local`, sector, displayName: sector });
  },
}));

import { GET } from "./route";
import { DELETE, GET as GET_TARGETS, PUT } from "./targets/route";
import { resetDashboardMemoryRows, setDashboardMemoryRows } from "@/lib/dashboard/data-source";
import { dashboardMemoryAuditForTests, resetDashboardTargetsMemoryForTests } from "@/lib/dashboard/targets-service";
import type { DashboardPayload } from "@/lib/dashboard/types";

const FULL = ["PRODUCCION", "DIRECCION"];
const AGGREGATE = OPERATIONAL_SECTOR_IDS.filter((s) => !FULL.includes(s));

function seed() {
  setDashboardMemoryRows(
    {
      pedidos: [
        { id: "p1", fecha: "2026-03-10", cliente: "E2E Cliente Reservado SA", producto: "Crema", estado: "ENTREGADO", q: 1000 },
        { id: "p2", fecha: "2026-03-12", cliente: "E2E Otro Cliente", producto: "Tónico", estado: "EN_ENVASADO", q: 500 },
      ],
      works: [
        {
          id: "w1",
          productionSector: "ENVASADO_MASIVO",
          operationalStatus: "completo",
          cancelled: false,
          finishedQty: "900",
          packagingTotalUnits: null,
          client: "E2E Cliente Reservado SA",
          product: "Crema",
          productionPedidoId: "p1",
          completedAt: "2026-03-18T12:00:00.000Z",
        },
      ],
      deliveries: [
        { id: "d1", workItemId: "w1", sourceSector: "ENVASADO_MASIVO", client: "E2E Cliente Reservado SA", pedidoId: "p1", actualDeliveredAt: "2026-03-25T12:00:00.000Z", status: "ENTREGADO" },
      ],
    },
    "2026-03-25T12:00:00.000Z"
  );
}

const url = (qs = "") => `http://localhost/api/v1/dashboard${qs ? `?${qs}` : ""}`;
const get = (sector: string, qs = "") => GET(new Request(url(qs), { headers: { "x-test-sector": sector } }));
const put = (sector: string, body: unknown) =>
  PUT(new Request("http://localhost/api/v1/dashboard/targets", { method: "PUT", headers: { "x-test-sector": sector, "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  resetDashboardMemoryRows();
  resetDashboardTargetsMemoryForTests();
  seed();
});

describe("GET /api/v1/dashboard — matriz de permisos (el servidor recorta el payload)", () => {
  it.each(FULL)("%s ve todo: clientes, ranking, servicio, lead time, objetivos editables", async (sector) => {
    const res = await get(sector, "year=2026");
    expect(res.status).toBe(200);
    const body = (await res.json()) as DashboardPayload;
    expect(body.permissions).toEqual({ level: "full", canEditTargets: true, canFilterClient: true, ownSector: null });
    expect(body.clients.available).toBe(true);
    if (body.clients.available) expect(body.clients.ranking.map((r) => r.client)).toContain("E2E Cliente Reservado SA");
    expect(body.filterOptions.clients).toContain("E2E Otro Cliente");
    expect("notAvailable" in body.main.nivelServicio).toBe(false);
    expect((body.main.nivelServicio as { value: number }).value).toBe(90);
    expect((body.main.leadTime as { value: number }).value).toBe(15);
    expect(Array.isArray(body.indicators) && body.indicators.length).toBe(4);
  });

  it.each(AGGREGATE)("%s recibe solo agregados: el payload NO contiene nombres de clientes", async (sector) => {
    const res = await get(sector, "year=2026");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/Reservado/);
    expect(text).not.toMatch(/Otro Cliente/);
    const body = JSON.parse(text) as DashboardPayload;
    expect(body.permissions.level).toBe("aggregate");
    expect(body.permissions.canEditTargets).toBe(false);
    expect(body.permissions.canFilterClient).toBe(false);
    expect(body.clients).toMatchObject({ available: false });
    expect(body.filterOptions.clients).toEqual([]);
    expect(body.main.nivelServicio).toMatchObject({ notAvailable: true });
    expect(body.main.leadTime).toMatchObject({ notAvailable: true });
    expect(body.main.sinReclamos).toMatchObject({ notAvailable: true });
    // agregados autorizados
    expect(body.main.unidades.value).toBe(900);
    expect(body.pedidos.entregados.value).toBe(1);
    expect(body.pedidos.activos.value).toBe(1);
    expect(body.produccion.monthly).toHaveLength(12);
    expect(body.pedidos.productosDistintos.value).toBe(1);
  });

  it("Envasado Masivo/Premium reciben su sector propio resaltado, sin clientes", async () => {
    const m = (await (await get("ENVASADO_MASIVO", "year=2026")).json()) as DashboardPayload;
    const p = (await (await get("ENVASADO_PREMIUM", "year=2026")).json()) as DashboardPayload;
    expect(m.permissions.ownSector).toBe("ENVASADO_MASIVO");
    expect(p.permissions.ownSector).toBe("ENVASADO_PREMIUM");
  });

  it.each(AGGREGATE)("%s no puede filtrar por cliente: 403 (no se ignora en silencio)", async (sector) => {
    const res = await get(sector, "year=2026&client=E2E%20Otro%20Cliente");
    expect(res.status).toBe(403);
    expect(await res.text()).not.toMatch(/Reservado/);
  });

  it("Producción sí filtra por cliente", async () => {
    const body = (await (await get("PRODUCCION", "year=2026&client=E2E%20Otro%20Cliente")).json()) as DashboardPayload;
    expect(body.pedidos.total).toBe(1);
    expect(body.header.client).toBe("E2E Otro Cliente");
  });

  it("filtros inválidos responden 400", async () => {
    expect((await get("PRODUCCION", "year=abc")).status).toBe(400);
    expect((await get("PRODUCCION", "year=2026&month=13")).status).toBe(400);
    expect((await get("PRODUCCION", "year=2026&sector=CALIDAD")).status).toBe(400);
  });

  it("filtros de mes y sector se aplican en el servidor", async () => {
    const mar = (await (await get("CALIDAD", "year=2026&month=3")).json()) as DashboardPayload;
    expect(mar.main.unidades.value).toBe(900);
    const abr = (await (await get("CALIDAD", "year=2026&month=4")).json()) as DashboardPayload;
    expect(abr.main.unidades.value).toBeNull();
    const prem = (await (await get("CALIDAD", "year=2026&sector=ENVASADO_PREMIUM")).json()) as DashboardPayload;
    expect(prem.main.unidades.value).toBeNull();
  });

  it("sin datos reales: todo «Sin datos suficientes» (nunca valores de relleno)", async () => {
    resetDashboardMemoryRows();
    const body = (await (await get("PRODUCCION", "year=2026")).json()) as DashboardPayload;
    expect(body.main.unidades.value).toBeNull();
    expect(body.pedidos.activos.value).toBeNull();
    expect((body.main.nivelServicio as { value: number | null }).value).toBeNull();
    expect(body.summary).toEqual([]);
    expect(body.dataSource).toBe("memory");
  });
});

describe("/api/v1/dashboard/targets — solo Producción/Dirección editan", () => {
  it.each(AGGREGATE)("%s no puede definir objetivos (403) y no se guarda nada", async (sector) => {
    const res = await put(sector, { key: "nivel_servicio", value: 95, direction: "min" });
    expect(res.status).toBe(403);
    const list = (await (await GET_TARGETS(new Request("http://localhost/api/v1/dashboard/targets", { headers: { "x-test-sector": sector } }))).json()) as { targets: unknown[] };
    expect(list.targets).toEqual([]);
    expect(dashboardMemoryAuditForTests()).toEqual([]);
  });

  it.each(FULL)("%s define un objetivo: se guarda, aparece en el semáforo y queda auditado", async (sector) => {
    const res = await put(sector, { key: "nivel_servicio", value: 95, direction: "min" });
    expect(res.status).toBe(200);
    const body = (await get(sector, "year=2026").then((r) => r.json())) as DashboardPayload;
    const row = (body.indicators as { key: string; light: string; target: { targetValue: number; updatedBy: string } | null }[]).find((i) => i.key === "nivel_servicio");
    expect(row?.target?.targetValue).toBe(95);
    expect(row?.target?.updatedBy).toBe(`${sector.toLowerCase()}@test.local`);
    expect(row?.light).toBe("amarillo"); // 90 ≥ 95 × 0,9
    const audit = dashboardMemoryAuditForTests();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "target_set", actorEmail: `${sector.toLowerCase()}@test.local`, actorSector: sector, key: "nivel_servicio" });
  });

  it("todos los sectores ven el objetivo del indicador de unidades (solo lectura)", async () => {
    await put("PRODUCCION", { key: "unidades_producidas", value: 500, direction: "min" });
    const body = (await (await get("ENVASADO_PREMIUM", "year=2026")).json()) as DashboardPayload;
    const rows = body.indicators as { key: string; light: string; target: { targetValue: number } | null }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].target?.targetValue).toBe(500);
    expect(rows[0].light).toBe("verde");
  });

  it("valida el objetivo: indicador desconocido, sentido, número y rango", async () => {
    expect((await put("PRODUCCION", { key: "otro", value: 1, direction: "min" })).status).toBe(400);
    expect((await put("PRODUCCION", { key: "lead_time", value: 5, direction: "arriba" })).status).toBe(400);
    expect((await put("PRODUCCION", { key: "lead_time", value: "cinco", direction: "max" })).status).toBe(400);
    expect((await put("PRODUCCION", { key: "nivel_servicio", value: 150, direction: "min" })).status).toBe(400);
    expect((await put("PRODUCCION", { key: "lead_time", value: -2, direction: "max" })).status).toBe(400);
    expect(dashboardMemoryAuditForTests()).toEqual([]);
  });

  it("quitar el objetivo vuelve a «Sin objetivo definido» y también se audita", async () => {
    await put("DIRECCION", { key: "lead_time", value: 25, direction: "max" });
    const del = await DELETE(new Request("http://localhost/api/v1/dashboard/targets?key=lead_time", { method: "DELETE", headers: { "x-test-sector": "DIRECCION" } }));
    expect(del.status).toBe(200);
    const body = (await (await get("DIRECCION", "year=2026")).json()) as DashboardPayload;
    const row = (body.indicators as { key: string; light: string; target: unknown }[]).find((i) => i.key === "lead_time");
    expect(row?.target).toBeNull();
    expect(dashboardMemoryAuditForTests().map((a) => a.action)).toEqual(["target_set", "target_cleared"]);
    const denied = await DELETE(new Request("http://localhost/api/v1/dashboard/targets?key=lead_time", { method: "DELETE", headers: { "x-test-sector": "CALIDAD" } }));
    expect(denied.status).toBe(403);
  });
});
