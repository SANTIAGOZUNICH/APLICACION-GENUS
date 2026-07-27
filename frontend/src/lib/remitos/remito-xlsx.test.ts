import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildRemitoXlsx, PRODUCT_BLOCK_ROWS } from "./remito-xlsx";
import type { RemitoLine, RemitoRecord } from "./types";

function line(partial: Partial<RemitoLine> & Pick<RemitoLine, "product">): RemitoLine {
  return {
    id: partial.id ?? "l1",
    remitoId: "r1",
    workItemId: partial.workItemId ?? "w1",
    product: partial.product,
    lote: partial.lote ?? "1234",
    vto: partial.vto ?? "2/8",
    totalUnits: partial.totalUnits ?? 0,
    cajas1: partial.cajas1 ?? 0,
    unidades1: partial.unidades1 ?? 0,
    cajas2: partial.cajas2 ?? 0,
    unidades2: partial.unidades2 ?? 0,
    cajas3: partial.cajas3 ?? 0,
    unidades3: partial.unidades3 ?? 0,
    extraCajas: partial.extraCajas ?? [],
    sortOrder: partial.sortOrder ?? 0,
  };
}

function remito(lines: RemitoLine[]): RemitoRecord {
  return {
    id: "r1",
    remitoNumber: "R-TEST",
    displayName: "Test Remito",
    clientIdNormalized: "thelma",
    clientDisplay: "THELMA Y LOUISE",
    deliveryDate: "2026-07-27",
    status: "GENERADO",
    version: 1,
    totalUnits: lines.reduce((s, l) => s + l.totalUnits, 0),
    totalCajas: 0,
    totalBultos: 0,
    snapshot: {},
    createdBy: "t@t.com",
    createdBySector: "PRODUCCION",
    updatedBy: "t@t.com",
    generatedBy: "t@t.com",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    lines,
    versions: [],
  };
}

describe("buildRemitoXlsx — REMITO_MODELO_APP", () => {
  it("usa hoja THELMA Y LOUISE, mapeo de celdas y fórmula de 3 cajas", async () => {
    const bytes = await buildRemitoXlsx(
      remito([
        line({
          product: "ACEITE",
          lote: "1234",
          vto: "2/8",
          cajas1: 2,
          unidades1: 10,
          cajas2: 1,
          unidades2: 5,
          cajas3: 3,
          unidades3: 4,
          totalUnits: 37,
        }),
      ])
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    const sheet = wb.getWorksheet("THELMA Y LOUISE");
    expect(sheet).toBeTruthy();
    expect(sheet!.getCell("A9").value).toBe("THELMA Y LOUISE");
    expect(sheet!.getCell("C23").value).toBe("ACEITE");
    expect(sheet!.getCell("D23").value).toBe(2);
    expect(sheet!.getCell("F23").value).toBe(10);
    expect(sheet!.getCell("H23").value).toBe(1);
    expect(sheet!.getCell("J23").value).toBe(5);
    expect(sheet!.getCell("L23").value).toBe(3);
    expect(sheet!.getCell("N23").value).toBe(4);
    const a23 = sheet!.getCell("A23").value as ExcelJS.CellFormulaValue;
    expect(a23).toMatchObject({ formula: "D23*F23+H23*J23+L23*N23" });
    expect(String(sheet!.getCell("C24").value)).toContain("L: 1234");
    expect(String(sheet!.getCell("C24").value)).toContain("VTO: 2/8");
    expect(sheet!.getCell("C47").value).toBe("TOTAL BULTOS: ");
    const a47 = sheet!.getCell("A47").value as ExcelJS.CellFormulaValue;
    expect(a47).toMatchObject({ formula: "A23" });
    const d47 = sheet!.getCell("D47").value as ExcelJS.CellFormulaValue;
    expect(d47.formula).toContain("D23");
    expect(d47.formula).toContain("L23");
    expect(sheet!.pageSetup.orientation).toBe("portrait");
    expect(sheet!.pageSetup.scale).toBe(81);
  });

  it("inserta bloques antes de totales si hay más de 6 productos", async () => {
    const lines = Array.from({ length: 8 }, (_, i) =>
      line({
        id: `l${i}`,
        workItemId: `w${i}`,
        product: `P${i + 1}`,
        lote: `L${i}`,
        vto: "1/1",
        cajas1: 1,
        unidades1: 2,
        totalUnits: 2,
        sortOrder: i,
      })
    );
    const bytes = await buildRemitoXlsx(remito(lines));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    const sheet = wb.getWorksheet("THELMA Y LOUISE")!;
    expect(sheet.getCell("C23").value).toBe("P1");
    expect(sheet.getCell("C43").value).toBe("P6");
    // 7° producto insertado en la antigua fila 47 (antes de totales)
    expect(sheet.getCell("C47").value).toBe("P7");
    expect(sheet.getCell("C51").value).toBe("P8");
    expect(sheet.getCell("C55").value).toBe("TOTAL BULTOS: ");
    const a55 = sheet.getCell("A55").value as ExcelJS.CellFormulaValue;
    expect(a55.formula).toContain("A23");
    expect(a55.formula).toContain("A51");
    expect(PRODUCT_BLOCK_ROWS).toHaveLength(6);
  });

  it("anota EXTRA cuando hay más de 3 combinaciones de caja", async () => {
    const bytes = await buildRemitoXlsx(
      remito([
        line({
          product: "EXTRA-P",
          cajas1: 1,
          unidades1: 10,
          cajas2: 1,
          unidades2: 5,
          cajas3: 1,
          unidades3: 2,
          extraCajas: [{ cajas: 2, unidades: 3 }],
          totalUnits: 23,
        }),
      ])
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    const sheet = wb.getWorksheet("THELMA Y LOUISE")!;
    expect(sheet.getCell("A23").value).toBe(23);
    expect(String(sheet.getCell("C24").value)).toContain("EXTRA:");
    expect(String(sheet.getCell("C24").value)).toContain("2×3");
  });
});
