import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildManagementReport } from "./analytics";
import { buildManagementReportWorkbook, buildReportFileName } from "./xlsx-generator";
import type { ReportDataset, WorkItemReportRow } from "./types";

function baseWorkItem(overrides: Partial<WorkItemReportRow>): WorkItemReportRow {
  return {
    id: "wi",
    client: "Cliente A",
    product: "Producto X",
    sector: "ENVASADO_MASIVO",
    status: "PUBLICADO",
    operationalStatus: "entregado",
    qualityStatus: "aprobado",
    plannedDate: "2026-08-01",
    deliveryDate: "2026-08-01",
    createdAt: new Date("2026-08-01T09:00:00.000Z"),
    completedAt: new Date("2026-08-01T12:00:00.000Z"),
    finishedQty: null,
    unit: "un.",
    packagingTotalUnits: null,
    deliverableUnits: 1000,
    sampleUnits: 2,
    packagingClosedAt: null,
    packagingClosedBy: null,
    createdBy: "produccion@genus",
    completedBy: "envasado@genus",
    progressUpdatedBy: "envasado@genus",
    qualityDecidedAt: new Date("2026-08-01T14:00:00.000Z"),
    qualityDecidedBy: "calidad@genus",
    qualityObservation: null,
    qualityChangeReason: null,
    sentToCodificadoAt: null,
    deliveredFromCodificadoAt: null,
    bulkRemainderKg: null,
    operationalCancelledAt: null,
    ...overrides,
  };
}

describe("buildManagementReportWorkbook", () => {
  it("genera un .xlsx válido con las hojas esperadas cuando hay datos", async () => {
    const dataset: ReportDataset = {
      workItems: [baseWorkItem({ id: "wi-a" })],
      deliveries: [],
      pedidos: [],
      meMaterials: [{ codigo: "ME-001", nombre: "Frasco 100ml", stockActual: 250 }],
    };
    const report = buildManagementReport(dataset, { from: "2026-08-01", to: "2026-08-31" });
    const wb = buildManagementReportWorkbook(report);
    const buf = await wb.xlsx.writeBuffer();
    expect(buf.byteLength).toBeGreaterThan(0);

    const roundTrip = new ExcelJS.Workbook();
    // Mismatch preexistente de tipos Buffer<ArrayBufferLike> vs Buffer en
    // todo el proyecto (mismo error ya presente y sin resolver en
    // remito-xlsx.test.ts/delivery-7f9f20c.test.ts) — no es un bug de este
    // archivo, es un choque de @types/node con los tipos vendored de exceljs.
    await roundTrip.xlsx.load(buf as Buffer);
    const sheetNames = roundTrip.worksheets.map((s) => s.name);
    expect(sheetNames).toContain("RESUMEN");
    expect(sheetNames).toContain("KPIS");
    expect(sheetNames).toContain("CLIENTES");
    expect(sheetNames).toContain("MUESTRAS");
    expect(sheetNames).toContain("INVENTARIO");
    expect(sheetNames).toContain("DATOS");
    // No hay pedidos/entregas en el dataset → esas hojas no deben crearse.
    expect(sheetNames).not.toContain("PEDIDOS");
    expect(sheetNames).not.toContain("ENTREGAS");
  });

  it("no crea hojas vacías cuando el dataset está vacío (solo RESUMEN y KPIS)", async () => {
    const dataset: ReportDataset = { workItems: [], deliveries: [], pedidos: [], meMaterials: [] };
    const report = buildManagementReport(dataset, { from: "2026-08-01", to: "2026-08-31" });
    const wb = buildManagementReportWorkbook(report);
    const sheetNames = wb.worksheets.map((s) => s.name);
    expect(sheetNames).toContain("RESUMEN");
    expect(sheetNames).toContain("KPIS");
    expect(sheetNames).not.toContain("CLIENTES");
    expect(sheetNames).not.toContain("DATOS");
  });
});

describe("buildReportFileName", () => {
  it("usa formato mensual cuando el rango es un mes calendario completo", () => {
    expect(buildReportFileName("2026-08-01", "2026-08-31")).toBe("GENUS_OS_REPORTE_2026-08.xlsx");
  });

  it("usa formato de rango cuando no es un mes completo", () => {
    expect(buildReportFileName("2026-08-05", "2026-08-20")).toBe("GENUS_OS_REPORTE_2026-08-05_a_2026-08-20.xlsx");
  });
});
