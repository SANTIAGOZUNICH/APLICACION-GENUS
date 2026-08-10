import { describe, expect, it } from "vitest";
import { buildManagementReport } from "./analytics";
import type { ReportDataset, ReportFilters, WorkItemReportRow } from "./types";

const BASE_CREATED = new Date("2026-08-01T09:00:00.000Z");

function hoursLater(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 3_600_000);
}

function baseWorkItem(overrides: Partial<WorkItemReportRow>): WorkItemReportRow {
  return {
    id: "wi-default",
    client: "Cliente",
    product: "Producto",
    sector: "ENVASADO_MASIVO",
    status: "PUBLICADO",
    operationalStatus: "entregado",
    qualityStatus: "aprobado",
    plannedDate: "2026-08-01",
    deliveryDate: "2026-08-01",
    createdAt: BASE_CREATED,
    completedAt: null,
    finishedQty: null,
    unit: "un.",
    packagingTotalUnits: null,
    deliverableUnits: null,
    sampleUnits: null,
    packagingClosedAt: null,
    packagingClosedBy: null,
    createdBy: "produccion@genus",
    completedBy: "envasado@genus",
    progressUpdatedBy: "envasado@genus",
    qualityDecidedAt: null,
    qualityDecidedBy: null,
    qualityObservation: null,
    qualityChangeReason: null,
    sentToCodificadoAt: null,
    deliveredFromCodificadoAt: null,
    bulkRemainderKg: null,
    operationalCancelledAt: null,
    ...overrides,
  };
}

// Trabajo A: Cliente A / Producto X / 1002 acondicionadas / 2 muestras / 1000 entregables / 3h.
const trabajoA = baseWorkItem({
  id: "wi-a",
  client: "Cliente A",
  product: "Producto X",
  deliverableUnits: 1000,
  sampleUnits: 2,
  completedAt: hoursLater(BASE_CREATED, 3),
});

// Trabajo B: Cliente A / Producto Y / 2000 entregables / 4h.
const trabajoB = baseWorkItem({
  id: "wi-b",
  client: "Cliente A",
  product: "Producto Y",
  deliverableUnits: 2000,
  sampleUnits: 0,
  completedAt: hoursLater(BASE_CREATED, 4),
});

// Trabajo C: Cliente B / Producto X / 500 entregables / 2h.
const trabajoC = baseWorkItem({
  id: "wi-c",
  client: "Cliente B",
  product: "Producto X",
  sector: "ENVASADO_PREMIUM",
  deliverableUnits: 500,
  sampleUnits: 0,
  completedAt: hoursLater(BASE_CREATED, 2),
});

const dataset: ReportDataset = {
  workItems: [trabajoA, trabajoB, trabajoC],
  deliveries: [],
  pedidos: [],
  meMaterials: [],
};

const filters: ReportFilters = { from: "2026-08-01", to: "2026-08-31" };

describe("buildManagementReport — dataset controlado Trabajo A/B/C", () => {
  const report = buildManagementReport(dataset, filters);

  it("resumen: totales de entregable y muestras", () => {
    expect(report.resumen.totalTrabajos).toBe(3);
    expect(report.resumen.totalEntregable).toBe(3500); // 1000 + 2000 + 500
    expect(report.resumen.totalMuestras).toBe(2);
  });

  it("clientes: Cliente A agrupa A+B, participación correcta", () => {
    const clienteA = report.clientes.find((c) => c.cliente === "Cliente A");
    const clienteB = report.clientes.find((c) => c.cliente === "Cliente B");
    expect(clienteA?.trabajos).toBe(2);
    expect(clienteA?.unidadesEntregables).toBe(3000); // 1000 + 2000
    expect(clienteA?.muestras).toBe(2);
    // 3000 / 3500 = 85.71%
    expect(clienteA?.participacionPct).toBeCloseTo(85.71, 1);
    expect(clienteB?.trabajos).toBe(1);
    expect(clienteB?.unidadesEntregables).toBe(500);
  });

  it("productos: Producto X agrupa A+C", () => {
    const productoX = report.productos.find((p) => p.producto === "Producto X");
    expect(productoX?.trabajos).toBe(2);
    expect(productoX?.unidadesEntregables).toBe(1500); // 1000 + 500
    expect(productoX?.muestras).toBe(2);
  });

  it("productividad: unidades/hora por trabajo (1000/3, 2000/4=500, 500/2=250)", () => {
    const a = report.productividad.find((p) => p.workItemId === "wi-a");
    const b = report.productividad.find((p) => p.workItemId === "wi-b");
    const c = report.productividad.find((p) => p.workItemId === "wi-c");
    expect(a?.unidadesPorHora).toBeCloseTo(333.33, 1);
    expect(b?.unidadesPorHora).toBe(500);
    expect(c?.unidadesPorHora).toBe(250);
  });

  it("muestras: solo Trabajo A tiene muestras, % sobre acondicionado", () => {
    expect(report.muestras).toHaveLength(1);
    const m = report.muestras[0];
    expect(m.cliente).toBe("Cliente A");
    expect(m.producto).toBe("Producto X");
    expect(m.muestras).toBe(2);
    expect(m.producido).toBe(1002); // 1000 + 2 muestras
    expect(m.muestrasPct).toBeCloseTo(0.2, 2);
  });

  it("sectores: Envasado Masivo (A+B) vs Envasado Premium (C)", () => {
    const masivo = report.sectores.find((s) => s.sector === "ENVASADO_MASIVO");
    const premium = report.sectores.find((s) => s.sector === "ENVASADO_PREMIUM");
    expect(masivo?.trabajos).toBe(2);
    expect(masivo?.unidadesEntregables).toBe(3000);
    expect(premium?.trabajos).toBe(1);
    expect(premium?.unidadesEntregables).toBe(500);
  });

  it("KPI tiempo efectivo de trabajo: no disponible, con motivo documentado", () => {
    const kpi = report.kpis.find((k) => k.indicador.includes("Tiempo efectivo de trabajo"));
    expect(kpi?.disponible).toBe(false);
    expect(kpi?.motivoNoDisponible).toBeTruthy();
  });

  it("datos: hoja granular con un renglón por trabajo", () => {
    expect(report.datos).toHaveLength(3);
    const a = report.datos.find((d) => d.workItemId === "wi-a");
    expect(a?.unidadesAcondicionadas).toBe(1002);
    expect(a?.unidadesEntregables).toBe(1000);
    expect(a?.muestras).toBe(2);
  });
});

describe("buildManagementReport — filtros opcionales", () => {
  it("filtra por cliente", () => {
    const report = buildManagementReport(dataset, { ...filters, client: "Cliente B" });
    expect(report.resumen.totalTrabajos).toBe(1);
    expect(report.resumen.totalEntregable).toBe(500);
  });

  it("filtra por producto", () => {
    const report = buildManagementReport(dataset, { ...filters, product: "Producto X" });
    expect(report.resumen.totalTrabajos).toBe(2);
    expect(report.resumen.totalEntregable).toBe(1500);
  });

  it("filtra por sector", () => {
    const report = buildManagementReport(dataset, { ...filters, sector: "ENVASADO_PREMIUM" });
    expect(report.resumen.totalTrabajos).toBe(1);
    expect(report.resumen.totalEntregable).toBe(500);
  });
});

describe("buildManagementReport — casos límite de productividad", () => {
  it("excluye unidades/hora cuando no hay completedAt (0/NaN/Infinity nunca aparecen)", () => {
    const sinCompletar = baseWorkItem({ id: "wi-sin-completar", completedAt: null, deliverableUnits: 100 });
    const report = buildManagementReport(
      { workItems: [sinCompletar], deliveries: [], pedidos: [], meMaterials: [] },
      filters
    );
    expect(report.productividad[0].unidadesPorHora).toBeNull();
    expect(report.productividad[0].leadTimeHoras).toBeNull();
  });

  it("excluye unidades/hora cuando el lead time es 0 (createdAt === completedAt)", () => {
    const instantaneo = baseWorkItem({
      id: "wi-instantaneo",
      completedAt: BASE_CREATED,
      deliverableUnits: 100,
    });
    const report = buildManagementReport(
      { workItems: [instantaneo], deliveries: [], pedidos: [], meMaterials: [] },
      filters
    );
    expect(report.productividad[0].unidadesPorHora).toBeNull();
  });
});
