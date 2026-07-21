/**
 * Persistencia Neon del banco de fórmulas usable desde CLI (sin server-only).
 * No imprime ingredientes.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import {
  formulaImportRuns,
  formulaIngredients,
  formulaProcedureSteps,
  formulaProducts,
  formulaProposals,
  formulaSpecifications,
  formulaVersions,
} from "../src/lib/db/schema";
import type { MemoryFormulaBank } from "../src/lib/formulas/formula-bank-service";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

function getUrl(): string {
  return (
    process.env.DATABASE_URL_UNPOOLED?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    ""
  );
}

export function isCliDatabaseConfigured() {
  return Boolean(getUrl());
}

function getCliDb() {
  const url = getUrl();
  if (!url) throw new Error("DATABASE_URL ausente");
  return drizzle(neon(url));
}

export async function cliHasCompletedImport(archiveHash: string): Promise<boolean> {
  const db = getCliDb();
  const rows = await db
    .select()
    .from(formulaImportRuns)
    .where(eq(formulaImportRuns.sourceArchiveHash, archiveHash));
  return rows.some((r) => r.status === "COMPLETED");
}

export async function cliPersistFormulaBank(store: MemoryFormulaBank): Promise<void> {
  const db = getCliDb();

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

export async function cliRecordImportRun(input: {
  archiveHash: string;
  status: "COMPLETED" | "FAILED" | "PARTIAL";
  filesScanned: number;
  formulasDetected: number;
  inserted: number;
  duplicated: number;
  warnings?: string[];
  errors?: string[];
}): Promise<string> {
  const db = getCliDb();
  const id = randomUUID();
  await db.insert(formulaImportRuns).values({
    id,
    sourceArchiveHash: input.archiveHash,
    startedAt: new Date(),
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
