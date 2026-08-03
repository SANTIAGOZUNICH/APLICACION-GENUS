/**
 * Smoke local/unitario 7f9f20c — totales remito CREMA+SHAMPOO + no auto-create hook.
 * No aplica migraciones. No Production.
 */
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildRemitoXlsx } from "./remito-xlsx";
import { softUpsertRemitoFromQualityApproval } from "./quality-hook";
import {
  remitoComposeSummary,
  withComposeAutoTotal,
} from "./compose-from-quality";

describe("7f9f20c remito delivery checks", () => {
  it("quality hook is no-op (no auto remito)", async () => {
    await expect(
      softUpsertRemitoFromQualityApproval({
        itemId: "qc:TEST_noop",
        status: "aprobado",
        actorEmail: "calidad@test",
        actorSector: "CALIDAD",
      })
    ).resolves.toBeUndefined();
  });

  it("Excel A23/A27/A47/D47 = 1000/1200/2200/160", async () => {
    const bytes = await buildRemitoXlsx({
      id: "r",
      remitoNumber: "R",
      displayName: "TEST",
      clientIdNormalized: "test_cliente_remito",
      clientDisplay: "TEST_CLIENTE_REMITO",
      deliveryDate: "2026-07-30",
      status: "GENERADO",
      version: 1,
      totalUnits: 2200,
      totalCajas: 160,
      totalBultos: 160,
      snapshot: {},
      createdBy: "t",
      createdBySector: "PRODUCCION",
      updatedBy: "t",
      generatedBy: "t",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      generatedAt: new Date().toISOString(),
      lines: [
        {
          id: "1",
          remitoId: "r",
          workItemId: "w1",
          product: "CREMA TEST",
          lote: "L1",
          vto: "30/7",
          totalUnits: 1000,
          cajas1: 100,
          unidades1: 10,
          cajas2: 0,
          unidades2: 0,
          cajas3: 0,
          unidades3: 0,
          extraCajas: [],
          sortOrder: 0,
        },
        {
          id: "2",
          remitoId: "r",
          workItemId: "w2",
          product: "SHAMPOO TEST",
          lote: "L2",
          vto: "30/7",
          totalUnits: 1200,
          cajas1: 60,
          unidades1: 20,
          cajas2: 0,
          unidades2: 0,
          cajas3: 0,
          unidades3: 0,
          extraCajas: [],
          sortOrder: 1,
        },
      ],
      versions: [],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    const sheet = wb.getWorksheet("THELMA Y LOUISE");
    expect(sheet).toBeTruthy();
    const a23 = sheet.getCell("A23").value;
    const a27 = sheet.getCell("A27").value;
    const a47 = sheet.getCell("A47").value;
    const d47 = sheet.getCell("D47").value;
    expect(a23).toMatchObject({ result: 1000 });
    expect(a27).toMatchObject({ result: 1200 });
    expect(a47).toMatchObject({ formula: "A23+A27", result: 2200 });
    expect(d47).toMatchObject({ result: 160 });
    expect(sheet.getCell("C47").value).toBe("TOTAL BULTOS: ");
  });

  it("editor summary matches", () => {
    const lines = [
      withComposeAutoTotal({
        id: "1",
        remitoId: "",
        workItemId: "w1",
        product: "CREMA TEST",
        lote: "L1",
        vto: "30/7",
        totalUnits: 0,
        cajas1: 100,
        unidades1: 10,
        cajas2: 0,
        unidades2: 0,
        cajas3: 0,
        unidades3: 0,
        extraCajas: [],
        sortOrder: 0,
        producedUnits: 1000,
      }),
      withComposeAutoTotal({
        id: "2",
        remitoId: "",
        workItemId: "w2",
        product: "SHAMPOO TEST",
        lote: "L2",
        vto: "30/7",
        totalUnits: 0,
        cajas1: 60,
        unidades1: 20,
        cajas2: 0,
        unidades2: 0,
        cajas3: 0,
        unidades3: 0,
        extraCajas: [],
        sortOrder: 1,
        producedUnits: 1200,
      }),
    ];
    const s = remitoComposeSummary(lines);
    expect(s).toEqual({
      totalProductos: 2,
      totalBultos: 160,
      totalUnidades: 2200,
      totalProducido: 2200,
    });
  });
});
