import { describe, expect, it } from "vitest";
import { evaluateOeFormula, oeCompositionSignature, selfCheckOeRows, type OeFormulaRow } from "@/lib/formulas/oe-formula-compare";

const row = (materiaPrima: string, codigo: string, formulaPct: number | null, parentRowId: string | null = null): OeFormulaRow => ({ materiaPrima, codigo, formulaPct, parentRowId });
const appr = [
  { materialName: "ALCOHOL", materialCodeOrPhase: "A1", percentage: 60 },
  { materialName: "AGUA", materialCodeOrPhase: "A2", percentage: 39.5 },
  { materialName: "FRAGANCIA", materialCodeOrPhase: "A3", percentage: 0.5 },
];

describe("evaluateOeFormula", () => {
  it("OE igual a la fórmula aprobada es consistente (incluye componentes <1 %)", () => {
    const ev = evaluateOeFormula([row("ALCOHOL", "A1", 60), row("AGUA", "A2", 39.5), row("FRAGANCIA", "A3", 0.5)], appr);
    expect(ev.consistent).toBe(true);
    expect(ev.rows.every((r) => r.status === "OK")).toBe(true);
    expect(ev.oePctSum).toBe(100);
  });
  it("alcohol 71 % vs 60 % aprobado: suma 100 pero NO consistente (caso AFTER SHAVE BASE)", () => {
    const ev = evaluateOeFormula([row("ALCOHOL", "A1", 71), row("AGUA", "A2", 28.1), row("FRAGANCIA", "A3", 0.9)], appr);
    expect(ev.consistent).toBe(false);
    expect(ev.issues).toContain("PORCENTAJE_DISTINTO");
    expect(ev.rows.find((r) => r.materiaPrima === "ALCOHOL")).toMatchObject({ pctAprobado: 60, pctOe: 71, diferencia: 11, status: "DIFERENTE" });
  });
  it("MP omitida y MP extra", () => {
    const ev = evaluateOeFormula([row("ALCOHOL", "A1", 60), row("AGUA", "A2", 39.5), row("OTRA", "Z9", 0.5)], appr);
    expect(ev.issues).toEqual(expect.arrayContaining(["MP_FALTANTE", "MP_EXTRA"]));
  });
  it("sin fuente: solo autocontrol de suma", () => {
    const ok = evaluateOeFormula([row("A", "1", 60), row("B", "2", 40)], null);
    expect(ok.comparedAgainstSource).toBe(false);
    expect(ok.consistent).toBe(true);
    const bad = evaluateOeFormula([row("A", "1", 60), row("B", "2", 25)], null);
    expect(bad.issues).toContain("SUMA_FUERA_DE_RANGO");
  });
  it("las filas de lote adicional no cuentan en la suma", () => {
    expect(selfCheckOeRows([row("A", "1", 60), row("B", "2", 40), row("A", "1", null, "x")]).issues).toEqual([]);
  });
  it("decimales: diferencia de redondeo ínfima es tolerada", () => {
    const ev = evaluateOeFormula([row("ALCOHOL", "A1", 60.0001), row("AGUA", "A2", 39.5), row("FRAGANCIA", "A3", 0.5)], appr);
    expect(ev.consistent).toBe(true);
  });
  it("la firma cambia si cambia un %", () => {
    const a = oeCompositionSignature([row("A", "1", 60)]);
    expect(a).not.toBe(oeCompositionSignature([row("A", "1", 61)]));
  });
});
