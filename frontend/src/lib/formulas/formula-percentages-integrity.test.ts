/**
 * Integridad de porcentajes de punta a punta (caso AFTER SHAVE BASE · ORIGINAL BLACK): el % de la hoja de Drive se conserva EXACTO en
 * parser → banco → OE → recálculo, sin normalizar a 100 %.
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseWorkbookBuffer } from "@/lib/formulas/parse-workbook";
import { createEmptyOeContent, emptyOeMaterial, recomputeOeDerived } from "@/lib/orders/content";

function xlsx(aoa: (string | number)[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "AFTER SHAVE BASE");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
const meta = { sourceFile: "ROOT/ORIGINAL BLACK/AFTER SHAVE BASE.xlsx", sourceModifiedAt: "2026-01-01T00:00:00.000Z", folderClient: "ORIGINAL BLACK" };
const parse = (rows: (string | number)[][]) => parseWorkbookBuffer(xlsx([["Producto", "AFTER SHAVE BASE"], ...rows, ["PROCEDIMIENTO"], ["Paso"]]), meta)[0]!;

describe("el % de la fórmula se conserva exacto", () => {
  it("ORIGINAL BLACK real: 60 / 2,5 / 20 / 2 + COLORANTE 0 kg (lote 210): % exactos, aviso de base, usable", () => {
    const d = parse([
      ["MATERIA PRIMA", "Fórmula %", "Kg a pesar"],
      ["ALCOHOL", 60, 126],
      ["FRAGANCIA", 2.5, 5.25],
      ["AGUA", 20, 42],
      ["GLICERINA", 2, 4.2],
      ["COLORANTE", "", 0],
    ]);
    expect(d.ingredients.map((i) => i.percentage)).toEqual([60, 2.5, 20, 2, 0]);
    expect(d.ingredients.find((i) => i.materialName === "ALCOHOL")!.percentage).not.toBeCloseTo(71, 0);
    expect(d.originalPercentageTotal).toBe(84.5);
    expect(d.percentageTotal).toBe(84.5);
    expect(d.reviewRequired).toBe(false); // no se bloquea ni se corrige: se avisa
    expect(d.warnings.join(" ")).toMatch(/otra base/);
  });
  it("base ambigua: cantidades de la hoja no proporcionales a los valores → revisión", () => {
    const d = parse([
      ["MATERIA PRIMA", "Fórmula %", "Kg a pesar"],
      ["ALCOHOL", 60, 126],
      ["AGUA", 24.5, 10],
    ]);
    expect(d.reviewRequired).toBe(true);
    expect(d.reviewReasons).toContain("QUANTITY_PCT_MISMATCH");
    expect(d.ingredients.map((i) => i.percentage)).toEqual([60, 24.5]);
  });
  it("fórmula completa (suma 100): % idénticos, incluye <1 % y decimales", () => {
    const d = parse([
      ["MATERIA PRIMA", "Fórmula %", "Kg a pesar"],
      ["ALCOHOL", 60, 60],
      ["AGUA", 39.35, 39.35],
      ["FRAGANCIA", 0.5, 0.5],
      ["COLORANTE", 0.15, 0.15],
    ]);
    expect(d.reviewRequired).toBe(false);
    expect(d.ingredients.map((i) => i.percentage)).toEqual([60, 39.35, 0.5, 0.15]);
    expect(d.percentageTotal).toBe(100);
  });
  it("celdas con formato % de Excel (0,6) se leen como 60 %", () => {
    const d = parse([
      ["MATERIA PRIMA", "Fórmula %"],
      ["ALCOHOL", 0.6],
      ["AGUA", 0.395],
      ["FRAGANCIA", 0.005],
    ]);
    expect(d.ingredients.map((i) => i.percentage)).toEqual([60, 39.5, 0.5]);
  });
  it("fila sin % entre filas con %: revisión, no se completa por diferencia", () => {
    const d = parse([
      ["MATERIA PRIMA", "Fórmula %", "Kg a pesar"],
      ["ALCOHOL", 60, 60],
      ["AGUA", "", 40],
    ]);
    expect(d.ingredients.map((i) => i.percentage)).toEqual([60, null]);
    expect(d.reviewRequired).toBe(true);
  });
});

describe("ORIGINAL BLACK: cantidades a pesar = las del archivo aprobado", () => {
  it("lote 210 → 126 / 5,25 / 42 / 4,2 / 0 kg con los valores exactos (sin 71 %)", () => {
    const vals: Array<[string, number]> = [["ALCOHOL", 60], ["FRAGANCIA", 2.5], ["AGUA", 20], ["GLICERINA", 2], ["COLORANTE", 0]];
    const out = recomputeOeDerived({
      ...createEmptyOeContent({ quantityKg: 210 }),
      materials: vals.map(([n, p]) => emptyOeMaterial({ materiaPrima: n, codigo: n, formulaPct: p })),
    });
    expect(out.materials.map((m) => m.kgAPesar)).toEqual([126, 5.25, 42, 4.2, 0]);
    expect(out.materials.map((m) => m.formulaPct)).toEqual([60, 2.5, 20, 2, 0]);
    expect(out.totals.formulaPctSum).toBe(84.5);
  });
});

describe("OE: cambio de tamaño de lote no cambia el %", () => {
  it("100 kg → 60 kg; 250 kg → 150 kg (el % sigue 60)", () => {
    const m = emptyOeMaterial({ materiaPrima: "ALCOHOL", codigo: "A1", formulaPct: 60 });
    for (const [qty, kg] of [[100, 60], [250, 150]] as const) {
      const out = recomputeOeDerived({ ...createEmptyOeContent({ quantityKg: qty }), materials: [m] });
      expect(out.materials[0]!.formulaPct).toBe(60);
      expect(out.materials[0]!.kgAPesar).toBe(kg);
    }
  });
});

describe("Excel exportado de la OE muestra el mismo %", () => {
  it("alcohol 60 % sale como 60 y el total no se reescala", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const { buildOeXlsxBuffer } = await import("@/lib/orders/export-oe-xlsx");
    const form = recomputeOeDerived({
      ...createEmptyOeContent({ quantityKg: 250 }),
      materials: [
        emptyOeMaterial({ materiaPrima: "ALCOHOL", codigo: "A1", formulaPct: 60 }),
        emptyOeMaterial({ materiaPrima: "AGUA", codigo: "A2", formulaPct: 40 }),
      ],
    });
    const buf = await buildOeXlsxBuffer({ formData: form } as never);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    const ws = wb.getWorksheet("OE")!;
    const vals: unknown[] = [];
    ws.eachRow((r) => vals.push(r.getCell(4).value));
    expect(vals).toContain(60);
    expect(vals).toContain(40);
    expect(vals).not.toContain(71);
  });
});
