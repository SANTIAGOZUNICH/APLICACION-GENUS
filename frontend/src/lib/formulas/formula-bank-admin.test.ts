import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  FormulaBankConflictError,
  FormulaBankService,
  MemoryFormulaBank,
} from "@/lib/formulas/formula-bank-service";
import { listActiveFormulaOptions } from "@/lib/formulas/formula-options";
import type { FormulaProductRecord, FormulaVersionRecord } from "@/lib/formulas/types";

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
    Pick<FormulaVersionRecord, "id" | "productId" | "status">
): FormulaVersionRecord {
  return {
    version: 1,
    sourceHash: "h",
    semanticHash: "s",
    sourceFile: "CLI/Prod.xlsx",
    sourceSheet: "OE",
    sourceModifiedAt: null,
    importedAt: "2020-01-01T00:00:00.000Z",
    percentageTotal: 100,
    validationStatus: "OK",
    warnings: [],
    previousVersionId: null,
    conflictCode: null,
    altSourcePaths: [],
    ingredients: [{ id: "i1", position: 1, materialName: "A", materialCodeOrPhase: "", percentage: 100, notes: "" }],
    procedureSteps: [],
    specifications: [],
    reviewRequired: false,
    ...partial,
  };
}

describe("FormulaBankService admin lifecycle", () => {
  it("archiva (activeVersionId null) y excluye de opciones activas", () => {
    const store = new MemoryFormulaBank();
    const svc = new FormulaBankService(store);
    const pid = randomUUID();
    const vid = randomUUID();
    store.products.push(
      product({
        id: pid,
        displayClient: "ACME",
        displayProduct: "CREMA X",
        activeVersionId: vid,
      })
    );
    store.versions.push(
      version({ id: vid, productId: pid, status: "VIGENTE" })
    );

    const entry = svc.archiveFormula({
      productId: pid,
      reason: "Obsoleta",
      actorEmail: "calidad@test.com",
      actorSector: "CALIDAD",
    });
    expect(entry.archived).toBe(true);
    expect(store.products[0]!.activeVersionId).toBeNull();
    expect(listActiveFormulaOptions(store.products, store.versions)).toHaveLength(0);
  });

  it("restaura vigente tras archivar", () => {
    const store = new MemoryFormulaBank();
    const svc = new FormulaBankService(store);
    const pid = randomUUID();
    const vid = randomUUID();
    store.products.push(
      product({
        id: pid,
        displayClient: "ACME",
        displayProduct: "CREMA X",
        activeVersionId: vid,
      })
    );
    store.versions.push(
      version({ id: vid, productId: pid, status: "VIGENTE" })
    );
    svc.archiveFormula({
      productId: pid,
      reason: "Test",
      actorEmail: "mp@test.com",
      actorSector: "MATERIA_PRIMA",
    });
    const restored = svc.restoreFormula({
      productId: pid,
      reason: "Volver a usar",
      actorEmail: "prod@test.com",
      actorSector: "PRODUCCION",
    });
    expect(restored.archived).toBe(false);
    expect(store.products[0]!.activeVersionId).toBe(vid);
    expect(listActiveFormulaOptions(store.products, store.versions)).toHaveLength(1);
  });

  it("archivar con motivo vacío persiste Sin motivo informado", () => {
    const store = new MemoryFormulaBank();
    const svc = new FormulaBankService(store);
    const pid = randomUUID();
    store.products.push(
      product({
        id: pid,
        displayClient: "ACME",
        displayProduct: "X",
        activeVersionId: randomUUID(),
      })
    );
    const entry = svc.archiveFormula({
      productId: pid,
      reason: "  ",
      actorEmail: "a@b.com",
      actorSector: "CALIDAD",
    });
    expect(entry.archived).toBe(true);
    expect(store.adminAudit[0]?.reason).toBe("Sin motivo informado");
  });

  it("delete permanente falla 409 si hay referencias OE", async () => {
    const store = new MemoryFormulaBank();
    const svc = new FormulaBankService(store);
    const pid = randomUUID();
    const vid = randomUUID();
    store.products.push(
      product({
        id: pid,
        displayClient: "ACME",
        displayProduct: "X",
        activeVersionId: null,
      })
    );
    store.versions.push(
      version({ id: vid, productId: pid, status: "VIGENTE" })
    );

    await expect(
      svc.deleteFormulaPermanently(
        {
          productId: pid,
          reason: "Limpieza",
          actorEmail: "a@b.com",
          actorSector: "CALIDAD",
        },
        async () => [{ kind: "OE", id: "oe-1", label: "OE-001" }]
      )
    ).rejects.toMatchObject({
      name: "FormulaBankConflictError",
      status: 409,
    } satisfies Partial<FormulaBankConflictError>);

    expect(store.products).toHaveLength(1);
  });

  it("delete permanente ok sin referencias", async () => {
    const store = new MemoryFormulaBank();
    const svc = new FormulaBankService(store);
    const pid = randomUUID();
    store.products.push(
      product({
        id: pid,
        displayClient: "ACME",
        displayProduct: "X",
        activeVersionId: null,
      })
    );
    store.versions.push(
      version({ id: randomUUID(), productId: pid, status: "VIGENTE" })
    );

    const result = await svc.deleteFormulaPermanently(
      {
        productId: pid,
        reason: "Nunca usada",
        actorEmail: "a@b.com",
        actorSector: "PRODUCCION",
      },
      async () => []
    );
    expect(result.deletedProductId).toBe(pid);
    expect(store.products).toHaveLength(0);
    expect(store.versions).toHaveLength(0);
  });
});
