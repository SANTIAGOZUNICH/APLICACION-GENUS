import { describe, expect, it } from "vitest";
import { checkOeFormula } from "@/lib/orders/oe-formula-check";
import { createEmptyOeContent, emptyOeMaterial } from "@/lib/orders/content";
import type { FormulaBankService } from "@/lib/formulas/formula-bank-service";

const bank = (ings: Array<[string, string, number]>, trace: Partial<ReturnType<FormulaBankService["getVersionTrace"]> & object> = {}) =>
  ({
    getVersionForAuthorizedOrder: () => ({ ingredients: ings.map(([materialName, materialCodeOrPhase, percentage]) => ({ materialName, materialCodeOrPhase, percentage })) }),
    getVersionTrace: () => ({ reviewRequired: false, percentageSource: "ORIGINAL", originalPercentageTotal: 100, percentageTotal: 100, suspectDerivation: false, ...trace }),
  }) as unknown as FormulaBankService;

const oe = (rows: Array<[string, string, number]>) => ({
  ...createEmptyOeContent({ quantityKg: 100 }),
  materials: rows.map(([materiaPrima, codigo, formulaPct]) => emptyOeMaterial({ materiaPrima, codigo, formulaPct })),
});

describe("checkOeFormula contra la versión vinculada", () => {
  it("OE idéntica a la versión aprobada: no pendiente", () => {
    const r = checkOeFormula(oe([["ALCOHOL", "A1", 60], ["AGUA", "A2", 40]]), { formulaVersionId: "v1" }, bank([["ALCOHOL", "A1", 60], ["AGUA", "A2", 40]]));
    expect(r.pending).toBe(false);
  });
  it("OE con alcohol 71 % vs 60 % del banco: pendiente aunque sume 100", () => {
    const r = checkOeFormula(oe([["ALCOHOL", "A1", 71], ["AGUA", "A2", 29]]), { formulaVersionId: "v1" }, bank([["ALCOHOL", "A1", 60], ["AGUA", "A2", 40]]));
    expect(r.pending).toBe(true);
    expect(r.issues).toContain("PORCENTAJE_DISTINTO");
  });
  it("versión del banco con % reescalados por el parser anterior: no verificable → pendiente", () => {
    const r = checkOeFormula(oe([["ALCOHOL", "A1", 71], ["AGUA", "A2", 29]]), { formulaVersionId: "v1" }, bank([["ALCOHOL", "A1", 71], ["AGUA", "A2", 29]], { suspectDerivation: true, percentageSource: "DERIVED_FROM_QUANTITY", originalPercentageTotal: 84.5 }));
    expect(r.pending).toBe(true);
    expect(r.issues).toContain("FORMULA_NO_VERIFICABLE");
  });
  it("OE armada a mano sin fuente y suma fuera de rango: informa pero no bloquea", () => {
    const r = checkOeFormula(oe([["A", "1", 50], ["B", "2", 30]]), { formulaVersionId: null }, null);
    expect(r.issues).toContain("SUMA_FUERA_DE_RANGO");
    expect(r.pending).toBe(false);
  });
  it("sin vínculo al banco y suma 100: no se bloquea", () => {
    expect(checkOeFormula(oe([["A", "1", 50], ["B", "2", 50]]), { formulaVersionId: null }, null).pending).toBe(false);
  });
});
