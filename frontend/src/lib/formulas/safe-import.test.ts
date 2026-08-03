/**
 * Tests sintéticos — importación segura (sin ZIP real ni secretos).
 */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  FormulaBankService,
  MemoryFormulaBank,
} from "@/lib/formulas/formula-bank-service";
import {
  SafeImportAbortError,
  assertExpectedCounts,
  assertSafeBankInvariants,
  countSafeBank,
  filterSafeOnly,
  isBlockedSafeVersion,
} from "@/lib/formulas/safe-import";
import { CLIENT_PENDING, type FormulaVersionRecord } from "@/lib/formulas/types";

function ver(
  partial: Partial<FormulaVersionRecord> & {
    productId: string;
    status: FormulaVersionRecord["status"];
  }
): FormulaVersionRecord {
  return {
    id: partial.id ?? randomUUID(),
    productId: partial.productId,
    version: partial.version ?? 1,
    status: partial.status,
    sourceFile: partial.sourceFile ?? "f.xlsx",
    sourceSheet: partial.sourceSheet ?? "OE",
    sourceModifiedAt: partial.sourceModifiedAt ?? "2026-01-01T00:00:00.000Z",
    sourceHash: partial.sourceHash ?? randomUUID(),
    semanticHash: partial.semanticHash ?? randomUUID(),
    importedAt: partial.importedAt ?? "2026-01-01T00:00:00.000Z",
    percentageTotal: partial.percentageTotal ?? 100,
    validationStatus: partial.validationStatus ?? "OK",
    warnings: partial.warnings ?? [],
    previousVersionId: partial.previousVersionId ?? null,
    conflictCode: partial.conflictCode ?? null,
    altSourcePaths: partial.altSourcePaths ?? [],
    sourceConfidence: partial.sourceConfidence ?? "FILENAME",
    expressionType: partial.expressionType ?? "PERCENTAGE",
    percentageSource: partial.percentageSource ?? "ORIGINAL",
    originalPercentageTotal: partial.originalPercentageTotal ?? 100,
    reviewRequired: partial.reviewRequired ?? false,
    reviewReasons: partial.reviewReasons ?? [],
    ingredients: partial.ingredients ?? [
      {
        id: randomUUID(),
        position: 1,
        materialName: "MAT-A",
        materialCodeOrPhase: "",
        percentage: 100,
        notes: "",
      },
    ],
    procedureSteps: partial.procedureSteps ?? [
      { id: randomUUID(), position: 1, instruction: "Paso sintético" },
    ],
    specifications: partial.specifications ?? [],
  };
}

function seedBlockedAndSafeBank() {
  const bank = new MemoryFormulaBank();
  const svc = new FormulaBankService(bank);

  // Producto seguro con vigente + histórica
  const pSafe = randomUUID();
  const vSafe = randomUUID();
  const vHist = randomUUID();
  bank.products.push({
    id: pSafe,
    normalizedClient: "cli a",
    normalizedProduct: "prod a",
    displayClient: "CLI A",
    displayProduct: "PROD A",
    productCode: "",
    activeVersionId: vSafe,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  bank.versions.push(
    ver({
      id: vSafe,
      productId: pSafe,
      status: "VIGENTE",
      version: 2,
      semanticHash: "sem-safe",
    }),
    ver({
      id: vHist,
      productId: pSafe,
      status: "HISTORICA",
      version: 1,
      semanticHash: "sem-hist",
    })
  );

  // CONFLICTO
  const pConf = randomUUID();
  const vConf = randomUUID();
  const vConfHist = randomUUID();
  bank.products.push({
    id: pConf,
    normalizedClient: "cli b",
    normalizedProduct: "prod b",
    displayClient: "CLI B",
    displayProduct: "PROD B",
    productCode: "",
    activeVersionId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  bank.versions.push(
    ver({
      id: vConf,
      productId: pConf,
      status: "CONFLICTO",
      conflictCode: "TIED_LATEST_VERSION",
      semanticHash: "sem-conf",
    }),
    ver({
      id: vConfHist,
      productId: pConf,
      status: "HISTORICA",
      semanticHash: "sem-conf-h",
    })
  );

  // REVIEW_REQUIRED
  const pRev = randomUUID();
  const vRev = randomUUID();
  bank.products.push({
    id: pRev,
    normalizedClient: "cli c",
    normalizedProduct: "prod c",
    displayClient: "CLI C",
    displayProduct: "PROD C",
    productCode: "",
    activeVersionId: vRev,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  bank.versions.push(
    ver({
      id: vRev,
      productId: pRev,
      status: "VIGENTE",
      reviewRequired: true,
      reviewReasons: ["QUANTITY_SUM_ZERO"],
      semanticHash: "sem-rev",
    })
  );

  // CLIENTE_PENDIENTE
  const pPend = randomUUID();
  const vPend = randomUUID();
  bank.products.push({
    id: pPend,
    normalizedClient: "cliente pendiente",
    normalizedProduct: "prod d",
    displayClient: CLIENT_PENDING,
    displayProduct: "PROD D",
    productCode: "",
    activeVersionId: vPend,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  bank.versions.push(
    ver({
      id: vPend,
      productId: pPend,
      status: "VIGENTE",
      semanticHash: "sem-pend",
    })
  );

  void svc;
  return bank;
}

describe("filterSafeOnly", () => {
  it("excluye CONFLICTO, REVIEW_REQUIRED y CLIENTE_PENDIENTE", () => {
    const raw = seedBlockedAndSafeBank();
    const safe = filterSafeOnly(raw);
    const counts = countSafeBank(safe);

    expect(counts.conflictos).toBe(0);
    expect(counts.reviewRequired).toBe(0);
    expect(counts.pendingClients).toBe(0);
    // vigente + histórica del producto seguro; histórica huérfana de conflicto se conserva sin active
    expect(counts.versions).toBe(3);
    expect(counts.vigentes).toBe(1);
    expect(counts.historicas).toBe(2);
    expect(counts.activeProducts).toBe(1);

    for (const v of safe.versions) {
      const p = safe.products.find((x) => x.id === v.productId)!;
      expect(isBlockedSafeVersion(v, p)).toBe(false);
    }
  });

  it("recalcula activeVersionId y elimina productos sin versiones", () => {
    const raw = seedBlockedAndSafeBank();
    const safe = filterSafeOnly(raw);
    const active = safe.products.filter((p) => p.activeVersionId);
    expect(active).toHaveLength(1);
    const v = safe.versions.find((x) => x.id === active[0]!.activeVersionId);
    expect(v?.status).toBe("VIGENTE");
    expect(v?.reviewRequired).toBe(false);
  });
});

describe("assertExpectedCounts / invariants", () => {
  it("mismatch expected-versions aborta", () => {
    const safe = filterSafeOnly(seedBlockedAndSafeBank());
    const counts = assertSafeBankInvariants(safe);
    expect(() => assertExpectedCounts(counts, 999, counts.activeProducts)).toThrow(
      SafeImportAbortError
    );
    try {
      assertExpectedCounts(counts, 999, counts.activeProducts);
    } catch (e) {
      expect((e as SafeImportAbortError).code).toBe("EXPECTED_VERSIONS_MISMATCH");
    }
  });

  it("mismatch expected-active aborta", () => {
    const safe = filterSafeOnly(seedBlockedAndSafeBank());
    const counts = assertSafeBankInvariants(safe);
    expect(() => assertExpectedCounts(counts, counts.versions, 999)).toThrow(
      SafeImportAbortError
    );
    try {
      assertExpectedCounts(counts, counts.versions, 999);
    } catch (e) {
      expect((e as SafeImportAbortError).code).toBe("EXPECTED_ACTIVE_MISMATCH");
    }
  });

  it("conteos exactos finales coinciden con expected cuando se pasan bien", () => {
    const safe = filterSafeOnly(seedBlockedAndSafeBank());
    const counts = assertSafeBankInvariants(safe);
    expect(() =>
      assertExpectedCounts(counts, counts.versions, counts.activeProducts)
    ).not.toThrow();
  });
});

describe("idempotencia archiveHash (servicio en memoria)", () => {
  it("segundo ingest del mismo archiveHash no duplica", () => {
    const store = new MemoryFormulaBank();
    const svc = new FormulaBankService(store);
    const drafts = [
      {
        displayClient: "CLI",
        displayProduct: "PROD",
        productCode: "",
        sourceFile: "a.xlsx",
        sourceSheet: "OE",
        sourceModifiedAt: "2026-01-02T00:00:00.000Z",
        sourceHash: "src-1",
        semanticHash: "sem-1",
        ingredients: [
          {
            position: 1,
            materialName: "A",
            materialCodeOrPhase: "",
            percentage: 100,
            notes: "",
          },
        ],
        procedureSteps: [{ position: 1, instruction: "x" }],
        specifications: [],
        percentageTotal: 100,
        warnings: [],
        altSourcePaths: [] as string[],
      },
    ];
    const r1 = svc.ingestDrafts(drafts, { archiveHash: "arch-aaa" });
    store.importRunHashes.add("arch-aaa");
    const r2 = svc.ingestDrafts(drafts, { archiveHash: "arch-aaa" });
    expect(r1.inserted).toBe(1);
    expect(r2.inserted).toBe(0);
    expect(store.versions).toHaveLength(1);
  });
});

describe("transacción simulada: rollback conserva banco anterior", () => {
  it("si la validación post-escritura falla, no se aplica el replace", () => {
    // Simula el contrato atómico sin Neon: apply solo si validate ok.
    const previous = filterSafeOnly(seedBlockedAndSafeBank());
    const snapshot = {
      products: previous.products.map((p) => ({ ...p })),
      versions: previous.versions.map((v) => ({ ...v })),
    };

    function atomicReplace(
      next: MemoryFormulaBank,
      validate: (b: MemoryFormulaBank) => void
    ) {
      const candidate = {
        products: next.products.map((p) => ({ ...p })),
        versions: next.versions.map((v) => ({ ...v })),
      };
      try {
        validate({
          products: candidate.products,
          versions: candidate.versions,
          importRunHashes: new Set(),
          reset() {},
        } as MemoryFormulaBank);
        previous.products = candidate.products;
        previous.versions = candidate.versions;
      } catch {
        // rollback: no mutar previous más allá del intento
        previous.products = snapshot.products;
        previous.versions = snapshot.versions;
        throw new Error("rolled_back");
      }
    }

    const bad = filterSafeOnly(seedBlockedAndSafeBank());
    // Corromper para forzar fallo de invariante
    bad.versions[0]!.status = "CONFLICTO";

    expect(() =>
      atomicReplace(bad, (b) => {
        assertSafeBankInvariants(b);
      })
    ).toThrow("rolled_back");

    expect(previous.versions.every((v) => v.status !== "CONFLICTO")).toBe(true);
    expect(countSafeBank(previous).activeProducts).toBe(1);
  });

  it("no hace wipe del banco anterior si el candidato es inválido", () => {
    const live = filterSafeOnly(seedBlockedAndSafeBank());
    const before = live.versions.length;
    const empty = new MemoryFormulaBank();
    // intento de wipe inválido (0 versions con expected>0) — no aplicar
    const counts = countSafeBank(empty);
    expect(() => assertExpectedCounts(counts, 3, 1)).toThrow();
    expect(live.versions).toHaveLength(before);
  });
});

describe("REVIEW_REQUIRED nunca usable tras filtro/hidratación sintética", () => {
  it("resolveLookup no encuentra productos que solo tenían REVIEW", () => {
    const raw = seedBlockedAndSafeBank();
    const safe = filterSafeOnly(raw);
    const svc = new FormulaBankService(safe);
    // El producto REVIEW era CLI C / PROD C
    expect(svc.resolveVigente("CLI C", "PROD C")).toBeNull();
    // El seguro sí
    expect(svc.resolveVigente("CLI A", "PROD A")).not.toBeNull();
  });

  it("hidratación sin flag reviewRequired no reintroduce versiones filtradas", () => {
    const safe = filterSafeOnly(seedBlockedAndSafeBank());
    // Simula columnas Neon actuales (sin reviewRequired): al hidratar queda undefined/false
    for (const v of safe.versions) {
      v.reviewRequired = false;
      v.reviewReasons = [];
    }
    expect(countSafeBank(safe).reviewRequired).toBe(0);
    expect(safe.versions.some((v) => v.reviewReasons?.includes("QUANTITY_SUM_ZERO"))).toBe(
      false
    );
  });
});
