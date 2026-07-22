import { describe, expect, it } from "vitest";
import {
  buildAliases,
  findUniqueExactProduct,
  isNonHumanProductLabel,
  listActiveClients,
  listActiveFormulaOptions,
  searchClients,
  searchProductsForClient,
  visibleProductLabel,
} from "@/lib/formulas/formula-options";
import type {
  FormulaProductRecord,
  FormulaVersionRecord,
} from "@/lib/formulas/types";
import {
  FormulaBankService,
  MemoryFormulaBank,
} from "@/lib/formulas/formula-bank-service";

function product(
  partial: Partial<FormulaProductRecord> &
    Pick<FormulaProductRecord, "id" | "displayClient" | "displayProduct">
): FormulaProductRecord {
  return {
    normalizedClient: partial.displayClient.toLowerCase(),
    normalizedProduct: partial.displayProduct.toLowerCase(),
    productCode: "",
    activeVersionId: null,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    ...partial,
  };
}

function version(
  partial: Partial<FormulaVersionRecord> &
    Pick<FormulaVersionRecord, "id" | "productId">
): FormulaVersionRecord {
  return {
    version: 1,
    status: "VIGENTE",
    sourceHash: "h",
    semanticHash: "s",
    sourceFile: "",
    sourceSheet: "",
    sourceModifiedAt: "2020-01-01T00:00:00.000Z",
    importedAt: "2020-01-01T00:00:00.000Z",
    percentageTotal: 100,
    validationStatus: "OK",
    warnings: [],
    previousVersionId: null,
    conflictCode: null,
    altSourcePaths: [],
    ingredients: [],
    procedureSteps: [],
    specifications: [],
    reviewRequired: false,
    ...partial,
  };
}

describe("formula-options search & aliases", () => {
  const products: FormulaProductRecord[] = [
    product({
      id: "p1",
      displayClient: "UNICA",
      displayProduct: "SHAMPOO SOLIDO",
      normalizedClient: "unica",
      normalizedProduct: "shampoo solido",
      activeVersionId: "v1",
      productCode: "U-SS",
    }),
    product({
      id: "p2",
      displayClient: "UNICA",
      displayProduct: "OE",
      normalizedClient: "unica",
      normalizedProduct: "oe",
      activeVersionId: "v2",
    }),
    product({
      id: "p3",
      displayClient: "UNICA",
      displayProduct: "SERUM ÁCIDO HIALURÓNICO",
      normalizedClient: "unica",
      normalizedProduct: "serum acido hialuronico",
      activeVersionId: "v3",
    }),
  ];
  const versions: FormulaVersionRecord[] = [
    version({
      id: "v1",
      productId: "p1",
      sourceFile: "UNICA/SHAMPOO SOLIDO.xlsx",
      sourceSheet: "OE",
    }),
    version({
      id: "v2",
      productId: "p2",
      sourceFile: "UNICA/CREMA MANOS REPARADORA.xlsx",
      sourceSheet: "Hoja1",
    }),
    version({
      id: "v3",
      productId: "p3",
      sourceFile: "UNICA/SERUM ACIDO.xlsx",
      sourceSheet: "Formula",
    }),
  ];

  it("detecta labels no humanos", () => {
    expect(isNonHumanProductLabel("OE")).toBe(true);
    expect(isNonHumanProductLabel("Hoja1")).toBe(true);
    expect(isNonHumanProductLabel("SHAMPOO SOLIDO")).toBe(false);
  });

  it("visibleProductLabel prioriza filename humano sobre hoja genérica", () => {
    const p = products[1]!;
    const v = versions[1]!;
    expect(visibleProductLabel(p, v)).toMatch(/CREMA MANOS/i);
    expect(buildAliases(p, v, visibleProductLabel(p, v))).toEqual(
      expect.arrayContaining([expect.stringMatching(/CREMA MANOS/i)])
    );
  });

  it("uni sugiere UNICA; sham lista shampoos; acido encuentra ácido", () => {
    const opts = listActiveFormulaOptions(products, versions);
    expect(opts).toHaveLength(3);
    expect(listActiveClients(opts)).toEqual(["UNICA"]);

    const clients = searchClients(opts, "uni");
    expect(clients.map((c) => c.client)).toContain("UNICA");

    const sham = searchProductsForClient(opts, "UNICA", "sham");
    expect(sham.some((h) => /shampoo/i.test(h.productLabel))).toBe(true);

    const acido = searchProductsForClient(opts, "unica", "acido");
    expect(acido.some((h) => /acido|ácido/i.test(h.productLabel))).toBe(true);
  });

  it("exacto único por alias de filename", () => {
    const opts = listActiveFormulaOptions(products, versions);
    const hit = findUniqueExactProduct(opts, "UNICA", "CREMA MANOS REPARADORA");
    expect(hit?.productId).toBe("p2");
  });

  it("sin texto no sugiere (empezar a escribir)", () => {
    const opts = listActiveFormulaOptions(products, versions);
    expect(searchClients(opts, "")).toEqual([]);
    expect(searchProductsForClient(opts, "UNICA", "")).toEqual([]);
  });

  it("resolveByProductId carga versión correcta; fuzzy no auto-resuelve", () => {
    const store = new MemoryFormulaBank();
    store.products = products;
    store.versions = versions.map((v) => ({
      ...v,
      ingredients: [
        {
          id: "i1",
          position: 0,
          materialName: "X",
          materialCodeOrPhase: "",
          percentage: 100,
          notes: "",
        },
      ],
    }));
    const bank = new FormulaBankService(store);
    const byId = bank.resolveByProductId("p2");
    expect(byId.kind).toBe("found");
    if (byId.kind === "found") {
      expect(byId.snapshot.formulaVersionId).toBe("v2");
    }
    const miss = bank.resolveLookup("UNICA", "crema manos casi");
    expect(miss.kind).toBe("not_found");
    const alias = bank.resolveLookup("UNICA", "CREMA MANOS REPARADORA");
    expect(alias.kind).toBe("found");
  });

  it("cobertura: cada opción activa es seleccionable por productId", () => {
    const opts = listActiveFormulaOptions(products, versions);
    const store = new MemoryFormulaBank();
    store.products = products;
    store.versions = versions;
    const bank = new FormulaBankService(store);
    for (const o of opts) {
      const r = bank.resolveByProductId(o.productId);
      expect(r.kind).toBe("found");
      if (r.kind === "found") {
        expect(r.snapshot.formulaVersionId).toBe(o.versionId);
      }
    }
  });
});
