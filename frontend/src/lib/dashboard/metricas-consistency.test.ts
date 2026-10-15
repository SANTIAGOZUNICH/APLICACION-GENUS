import { beforeEach, describe, expect, it, vi } from "vitest";
import { OPERATIONAL_SECTOR_IDS } from "@/types/operational/sector";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({
  isDatabaseConfigured: () => false,
  getDb: () => {
    throw new Error("sin base en este test");
  },
}));

import { getMetricasService, resetMetricasMemoryForTests } from "@/lib/metricas/metricas-service";
import { computeTotals, type MetricsActor } from "@/lib/metricas/types";
import { OrdersForbiddenError } from "@/lib/orders/types";
import { resetDashboardMemoryRows } from "./data-source";
import { getDashboard } from "./service";
import { resetDashboardTargetsMemoryForTests } from "./targets-service";
import type { DashboardPayload } from "./types";

const MASIVO: MetricsActor = { email: "masivo@x.com", sector: "ENVASADO_MASIVO" };
const PREMIUM: MetricsActor = { email: "premium@x.com", sector: "ENVASADO_PREMIUM" };
const PROD: MetricsActor = { email: "prod@x.com", sector: "PRODUCCION" };
const svc = () => getMetricasService();
const YEAR = new Date().getFullYear();
const d = (m: number, day = 10) => `${YEAR}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

async function seed() {
  const c = (a: MetricsActor, metricDate: string, units: number, who: string, product = "SHAMPOO") =>
    svc().create(a, { metricDate, units, responsibleDisplay: who, product, targetSector: a.sector === "PRODUCCION" ? "ENVASADO_MASIVO" : undefined });
  await c(MASIVO, d(1), 1200, "Ana Secreta");
  await c(MASIVO, d(1, 11), 800, "ana  SECRETA");
  await c(MASIVO, d(3), 500, "Beto Reservado");
  await c(PREMIUM, d(1), 300, "Luisa Premium");
  await c(PREMIUM, d(3), 700, "Luisa Premium");
  await c(PREMIUM, d(4), 250, "Marta Premium");
}

const dash = (sector: string, qs: { month?: number; sector?: string } = {}) =>
  getDashboard(
    { email: `${sector.toLowerCase()}@x.com`, sector },
    { year: String(YEAR), month: qs.month ? String(qs.month) : null, sector: qs.sector ?? null }
  );

beforeEach(() => {
  resetMetricasMemoryForTests();
  resetDashboardMemoryRows();
  resetDashboardTargetsMemoryForTests();
});

describe("Dashboard == Métricas (misma fuente y misma función de totales)", () => {
  it.each([
    ["año completo / todos", {}],
    ["marzo", { month: 3 }],
    ["Masivo", { sector: "ENVASADO_MASIVO" }],
    ["Premium abril", { sector: "ENVASADO_PREMIUM", month: 4 }],
    ["mes sin registros", { month: 12 }],
  ] as const)("totales idénticos a los de Métricas: %s", async (_label, f) => {
    await seed();
    const p = await dash("PRODUCCION", f);
    const dateFrom = f && "month" in f && f.month ? d(f.month, 1) : `${YEAR}-01-01`;
    const dateTo = f && "month" in f && f.month ? d(f.month, 31) : `${YEAR}-12-31`;
    const sector = ("sector" in f ? f.sector : "ALL") as "ALL" | "ENVASADO_MASIVO" | "ENVASADO_PREMIUM";
    const metrics = await svc().list(PROD, { dateFrom, dateTo, sector });
    const exp = computeTotals(metrics);
    const { totals } = await svc().ranking(PROD, { dateFrom, dateTo, sector });
    expect(totals.totalUnits).toBe(exp.totalUnits);
    expect(p.productividad.kpis.total.value).toBe(exp.recordCount ? exp.totalUnits : null);
    expect(p.productividad.recordCount).toBe(exp.recordCount);
    const masivo = computeTotals(metrics.filter((r) => r.sector === "ENVASADO_MASIVO"));
    const premium = computeTotals(metrics.filter((r) => r.sector === "ENVASADO_PREMIUM"));
    if (sector !== "ENVASADO_PREMIUM") expect(p.productividad.kpis.masivo.value).toBe(exp.recordCount ? masivo.totalUnits : null);
    if (sector !== "ENVASADO_MASIVO") expect(p.productividad.kpis.premium.value).toBe(exp.recordCount ? premium.totalUnits : null);
  });

  it("también coincide con lo que ve un sector de Envasado en Métricas (su propio total)", async () => {
    await seed();
    const own = computeTotals(await svc().list(MASIVO, { dateFrom: `${YEAR}-01-01`, dateTo: `${YEAR}-12-31` }));
    const p = await dash("ENVASADO_MASIVO", { sector: "ENVASADO_MASIVO" });
    expect(p.productividad.kpis.total.value).toBe(own.totalUnits);
    expect(own.totalUnits).toBe(2500);
  });

  it("el ranking suma lo mismo que el ranking de Métricas (misma normalización de responsables)", async () => {
    await seed();
    const p = await dash("PRODUCCION");
    const metricsRanking = (await svc().ranking(PROD, { dateFrom: `${YEAR}-01-01`, dateTo: `${YEAR}-12-31` })).ranking;
    if (!p.productividad.responsibles.available) throw new Error("x");
    const dashRanking = p.productividad.responsibles.ranking.map((r) => [r.key, r.units]);
    expect(dashRanking).toEqual(metricsRanking.map((r) => [r.responsibleKey, r.totalUnits]));
    expect(p.productividad.responsibles.ranking[0]).toMatchObject({ name: expect.stringMatching(/ana/i), units: 2000 });
  });
});

describe("el Dashboard refleja Métricas al instante (sin caché obsoleta)", () => {
  it("alta, edición, importación, baja y restauración", async () => {
    await seed();
    expect((await dash("PRODUCCION")).productividad.kpis.total.value).toBe(3750);

    const created = await svc().create(MASIVO, { metricDate: d(5), units: 1000, responsibleDisplay: "Nuevo Responsable", product: "GEL" });
    expect((await dash("PRODUCCION")).productividad.kpis.total.value).toBe(4750);

    await svc().update(MASIVO, created.id, { units: 400 });
    expect((await dash("PRODUCCION")).productividad.kpis.total.value).toBe(4150);

    const imp = await svc().importCommit(PREMIUM, { batchId: "dash-0001", rows: [{ metricDate: d(6), product: "SERUM", units: 600, responsibleDisplay: "Importada", sector: "ENVASADO_PREMIUM" }] });
    expect(imp.created).toBe(1);
    const afterImport = await dash("PRODUCCION");
    expect(afterImport.productividad.kpis.total.value).toBe(4750);
    expect(afterImport.productividad.kpis.premium.value).toBe(1850);

    await svc().delete(MASIVO, created.id);
    expect((await dash("PRODUCCION")).productividad.kpis.total.value).toBe(4350); // soft delete: deja de contar
    await svc().restore(PROD, created.id);
    expect((await dash("PRODUCCION")).productividad.kpis.total.value).toBe(4750);
    expect((await dash("PRODUCCION")).header.lastDataChangeAt).toBeTruthy();
  });
});

describe("permisos por sector sobre Métricas (mínimo privilegio)", () => {
  it.each(OPERATIONAL_SECTOR_IDS)("%s: totales agregados visibles; nombres solo si corresponde y sin filtrar a otros", async (sector) => {
    await seed();
    const body = await dash(sector);
    const text = JSON.stringify(body);
    expect(body.productividad.kpis.total.value).toBe(3750);
    expect(body.productividad.kpis.premium.value).toBe(1250);
    expect(body.productividad.monthly).toHaveLength(12);
    const all = sector === "PRODUCCION" || sector === "DIRECCION";
    if (all) {
      expect(body.permissions.responsiblesScope).toBe("all");
      expect(text).toMatch(/Ana Secreta|ana secreta/i);
      expect(text).toMatch(/Luisa Premium/);
    } else if (sector === "ENVASADO_MASIVO") {
      expect(body.permissions.responsiblesScope).toBe("ENVASADO_MASIVO");
      expect(text).toMatch(/Beto Reservado/);
      expect(text).not.toMatch(/Luisa|Marta/);
    } else if (sector === "ENVASADO_PREMIUM") {
      expect(body.permissions.responsiblesScope).toBe("ENVASADO_PREMIUM");
      expect(text).toMatch(/Luisa Premium/);
      expect(text).not.toMatch(/Ana|Beto/i);
    } else {
      expect(body.permissions.responsiblesScope).toBeNull();
      expect(body.productividad.responsibles).toMatchObject({ available: false });
      expect(text).not.toMatch(/Ana|Beto|Luisa|Marta|Secreta|Reservado/i);
    }
  });

  it("Envasado Masivo filtrando Premium: totales sí, nombres no", async () => {
    await seed();
    const p: DashboardPayload = await dash("ENVASADO_MASIVO", { sector: "ENVASADO_PREMIUM" });
    expect(p.productividad.kpis.total.value).toBe(1250);
    expect(p.productividad.responsibles).toMatchObject({ available: false });
    expect(JSON.stringify(p)).not.toMatch(/Luisa|Marta/);
  });

  it("NO se amplían los permisos de Métricas: otros sectores siguen sin poder leerla ni editarla", async () => {
    await seed();
    const calidad: MetricsActor = { email: "c@x.com", sector: "CALIDAD" };
    await expect(svc().list(calidad)).rejects.toBeInstanceOf(OrdersForbiddenError);
    await expect(svc().create(calidad, { metricDate: d(2), units: 1, responsibleDisplay: "x" })).rejects.toBeInstanceOf(OrdersForbiddenError);
    // y el Dashboard no cambió nada en Métricas
    expect(computeTotals(await svc().list(PROD)).recordCount).toBe(6);
  });
});
