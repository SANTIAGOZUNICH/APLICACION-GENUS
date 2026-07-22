/**
 * Hidrata / persiste el banco de fórmulas en Neon.
 * No imprime ingredientes ni fórmulas en logs.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import {
  formulaImportRuns,
  formulaIngredients,
  formulaProcedureSteps,
  formulaProducts,
  formulaProposals,
  formulaSpecifications,
  formulaVersions,
} from "@/lib/db/schema";
import type { MemoryFormulaBank } from "./formula-bank-service";
import type {
  FormulaIngredient,
  FormulaProcedureStep,
  FormulaProductRecord,
  FormulaSpecification,
  FormulaVersionRecord,
  FormulaVersionStatus,
} from "./types";

let hydrated = false;

export function resetFormulaHydrationFlag() {
  hydrated = false;
}

export async function hydrateFormulaBankFromNeon(store: MemoryFormulaBank): Promise<void> {
  if (!isDatabaseConfigured() || hydrated) return;
  const db = getDb();

  const [products, versions, ingredients, steps, specs, runs] = await Promise.all([
    db.select().from(formulaProducts),
    db.select().from(formulaVersions),
    db.select().from(formulaIngredients),
    db.select().from(formulaProcedureSteps),
    db.select().from(formulaSpecifications),
    db.select().from(formulaImportRuns),
  ]);

  const ingsByVersion = new Map<string, FormulaIngredient[]>();
  for (const row of ingredients) {
    const list = ingsByVersion.get(row.formulaVersionId) ?? [];
    list.push({
      id: row.id,
      position: row.position,
      materialName: row.materialName,
      materialCodeOrPhase: row.materialCodeOrPhase ?? "",
      percentage: row.percentage == null || row.percentage === "" ? null : Number(row.percentage),
      notes: row.notes ?? "",
    });
    ingsByVersion.set(row.formulaVersionId, list);
  }

  const stepsByVersion = new Map<string, FormulaProcedureStep[]>();
  for (const row of steps) {
    const list = stepsByVersion.get(row.formulaVersionId) ?? [];
    list.push({
      id: row.id,
      position: row.position,
      instruction: row.instruction,
    });
    stepsByVersion.set(row.formulaVersionId, list);
  }

  const specsByVersion = new Map<string, FormulaSpecification[]>();
  for (const row of specs) {
    const list = specsByVersion.get(row.formulaVersionId) ?? [];
    list.push({
      id: row.id,
      type: row.type,
      name: row.name,
      expectedValue: row.expectedValue ?? "",
      unit: row.unit ?? "",
      notes: row.notes ?? "",
    });
    specsByVersion.set(row.formulaVersionId, list);
  }

  store.reset();
  store.products = products.map(
    (p): FormulaProductRecord => ({
      id: p.id,
      normalizedClient: p.normalizedClient,
      normalizedProduct: p.normalizedProduct,
      displayClient: p.displayClient,
      displayProduct: p.displayProduct,
      productCode: p.productCode ?? "",
      activeVersionId: p.activeVersionId,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })
  );

  store.versions = versions.map((v): FormulaVersionRecord => {
    const ings = (ingsByVersion.get(v.id) ?? []).sort((a, b) => a.position - b.position);
    const proc = (stepsByVersion.get(v.id) ?? []).sort((a, b) => a.position - b.position);
    const sp = specsByVersion.get(v.id) ?? [];
    return {
      id: v.id,
      productId: v.productId,
      version: v.version,
      status: v.status as FormulaVersionStatus,
      sourceFile: v.sourceFile,
      sourceSheet: v.sourceSheet,
      sourceModifiedAt: v.sourceModifiedAt ? v.sourceModifiedAt.toISOString() : null,
      sourceHash: v.sourceHash,
      semanticHash: v.semanticHash,
      importedAt: v.importedAt.toISOString(),
      percentageTotal:
        v.percentageTotal == null || v.percentageTotal === ""
          ? null
          : Number(v.percentageTotal),
      validationStatus: (v.validationStatus as "OK" | "WARN" | "ERROR") ?? "OK",
      warnings: Array.isArray(v.warnings) ? (v.warnings as string[]) : [],
      previousVersionId: v.previousVersionId,
      conflictCode: v.conflictCode,
      altSourcePaths: Array.isArray(v.altSourcePaths) ? (v.altSourcePaths as string[]) : [],
      ingredients: ings,
      procedureSteps: proc,
      specifications: sp,
    };
  });

  for (const run of runs) {
    if (run.status === "COMPLETED" && run.sourceArchiveHash) {
      store.importRunHashes.add(run.sourceArchiveHash);
    }
  }

  hydrated = true;
  void formulaProposals;
}

export async function persistFormulaBankSnapshot(store: MemoryFormulaBank): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const db = getDb();

  await db.delete(formulaProposals);
  await db.delete(formulaIngredients);
  await db.delete(formulaProcedureSteps);
  await db.delete(formulaSpecifications);
  await db.delete(formulaVersions);
  await db.delete(formulaProducts);

  if (store.products.length) {
    await db.insert(formulaProducts).values(
      store.products.map((p) => ({
        id: p.id,
        normalizedClient: p.normalizedClient,
        normalizedProduct: p.normalizedProduct,
        displayClient: p.displayClient,
        displayProduct: p.displayProduct,
        productCode: p.productCode || null,
        activeVersionId: p.activeVersionId,
        createdAt: new Date(p.createdAt),
        updatedAt: new Date(p.updatedAt),
      }))
    );
  }

  if (store.versions.length) {
    await db.insert(formulaVersions).values(
      store.versions.map((v) => ({
        id: v.id,
        productId: v.productId,
        version: v.version,
        status: v.status,
        sourceFile: v.sourceFile,
        sourceSheet: v.sourceSheet,
        sourceModifiedAt: v.sourceModifiedAt ? new Date(v.sourceModifiedAt) : null,
        sourceHash: v.sourceHash,
        semanticHash: v.semanticHash,
        importedAt: new Date(v.importedAt),
        percentageTotal: v.percentageTotal == null ? null : String(v.percentageTotal),
        validationStatus: v.validationStatus,
        warnings: v.warnings,
        previousVersionId: v.previousVersionId,
        conflictCode: v.conflictCode,
        altSourcePaths: v.altSourcePaths,
      }))
    );

    const allIngs = store.versions.flatMap((v) =>
      v.ingredients.map((i) => ({
        id: i.id,
        formulaVersionId: v.id,
        position: i.position,
        materialName: i.materialName,
        materialCodeOrPhase: i.materialCodeOrPhase || null,
        percentage: i.percentage == null ? null : String(i.percentage),
        notes: i.notes || null,
      }))
    );
    if (allIngs.length) await db.insert(formulaIngredients).values(allIngs);

    const allSteps = store.versions.flatMap((v) =>
      v.procedureSteps.map((s) => ({
        id: s.id,
        formulaVersionId: v.id,
        position: s.position,
        instruction: s.instruction,
      }))
    );
    if (allSteps.length) await db.insert(formulaProcedureSteps).values(allSteps);

    const allSpecs = store.versions.flatMap((v) =>
      v.specifications.map((s) => ({
        id: s.id,
        formulaVersionId: v.id,
        type: s.type,
        name: s.name,
        expectedValue: s.expectedValue || null,
        unit: s.unit || null,
        notes: s.notes || null,
      }))
    );
    if (allSpecs.length) await db.insert(formulaSpecifications).values(allSpecs);
  }
}

export async function recordFormulaImportRun(input: {
  archiveHash: string;
  status: "COMPLETED" | "FAILED" | "PARTIAL";
  filesScanned: number;
  formulasDetected: number;
  inserted: number;
  duplicated: number;
  warnings?: string[];
  errors?: string[];
  startedAt?: Date;
}): Promise<string> {
  if (!isDatabaseConfigured()) return "";
  const db = getDb();
  const id = randomUUID();
  await db.insert(formulaImportRuns).values({
    id,
    sourceArchiveHash: input.archiveHash,
    startedAt: input.startedAt ?? new Date(),
    completedAt: new Date(),
    status: input.status,
    filesScanned: input.filesScanned,
    formulasDetected: input.formulasDetected,
    inserted: input.inserted,
    duplicated: input.duplicated,
    warnings: input.warnings ?? [],
    errors: input.errors ?? [],
  });
  return id;
}

export async function hasCompletedFormulaImport(archiveHash: string): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  const db = getDb();
  const rows = await db.select().from(formulaImportRuns);
  return rows.some((r) => r.sourceArchiveHash === archiveHash && r.status === "COMPLETED");
}
