/**
 * Persistencia Neon del banco de fórmulas usable desde CLI (sin server-only).
 * Usa Pool + neon-serverless (transacciones reales). No imprime ingredientes.
 */
import { randomUUID } from "node:crypto";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq } from "drizzle-orm";
import ws from "ws";
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
import {
  assertSafeBankInvariants,
  countSafeBank,
  type SafeImportCounts,
} from "../src/lib/formulas/safe-import";

neonConfig.webSocketConstructor = ws;

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

function createCliPool() {
  const url = getUrl();
  if (!url) throw new Error("DATABASE_URL ausente");
  return new Pool({ connectionString: url });
}

export async function cliHasCompletedImport(archiveHash: string): Promise<boolean> {
  const pool = createCliPool();
  try {
    const db = drizzle(pool);
    const rows = await db
      .select()
      .from(formulaImportRuns)
      .where(eq(formulaImportRuns.sourceArchiveHash, archiveHash));
    return rows.some((r) => r.status === "COMPLETED");
  } finally {
    await pool.end();
  }
}

type PersistResult = {
  counts: SafeImportCounts;
  importRunId: string;
};

/**
 * Reemplazo atómico del banco: DELETE+INSERT+validación+COMPLETED en UNA transacción.
 * Si falla cualquier paso → ROLLBACK y el banco anterior permanece intacto.
 */
export async function cliPersistFormulaBankAtomic(
  store: MemoryFormulaBank,
  meta: {
    archiveHash: string;
    filesScanned: number;
    formulasDetected: number;
    duplicated: number;
    expectedVersions: number;
    expectedActive: number;
  }
): Promise<PersistResult> {
  const preCounts = assertSafeBankInvariants(store);
  if (preCounts.versions !== meta.expectedVersions) {
    throw new Error(
      `pre-write versions=${preCounts.versions} expected=${meta.expectedVersions}`
    );
  }
  if (preCounts.activeProducts !== meta.expectedActive) {
    throw new Error(
      `pre-write active=${preCounts.activeProducts} expected=${meta.expectedActive}`
    );
  }

  const pool = createCliPool();
  const importRunId = randomUUID();

  try {
    const db = drizzle(pool);
    const result = await db.transaction(async (tx) => {
      await tx.delete(formulaProposals);
      await tx.delete(formulaIngredients);
      await tx.delete(formulaProcedureSteps);
      await tx.delete(formulaSpecifications);
      await tx.delete(formulaVersions);
      await tx.delete(formulaProducts);

      if (store.products.length) {
        await tx.insert(formulaProducts).values(
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
        await tx.insert(formulaVersions).values(
          store.versions.map((v) => ({
            id: v.id,
            productId: v.productId,
            version: v.version,
            status: v.status,
            sourceFile: v.sourceFile,
            sourceSheet: v.sourceSheet,
            sourceModifiedAt: v.sourceModifiedAt
              ? new Date(v.sourceModifiedAt)
              : null,
            sourceHash: v.sourceHash,
            semanticHash: v.semanticHash,
            importedAt: new Date(v.importedAt),
            percentageTotal:
              v.percentageTotal == null ? null : String(v.percentageTotal),
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
        if (allIngs.length) await tx.insert(formulaIngredients).values(allIngs);

        const allSteps = store.versions.flatMap((v) =>
          v.procedureSteps.map((s) => ({
            id: s.id,
            formulaVersionId: v.id,
            position: s.position,
            instruction: s.instruction,
          }))
        );
        if (allSteps.length) await tx.insert(formulaProcedureSteps).values(allSteps);

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
        if (allSpecs.length) await tx.insert(formulaSpecifications).values(allSpecs);
      }

      // Validación post-escritura DENTRO de la misma transacción (lectura del snapshot nuevo).
      const dbProducts = await tx.select().from(formulaProducts);
      const dbVersions = await tx.select().from(formulaVersions);

      const versionCount = dbVersions.length;
      const vigentes = dbVersions.filter((v) => v.status === "VIGENTE").length;
      const historicas = dbVersions.filter((v) => v.status === "HISTORICA").length;
      const conflictos = dbVersions.filter((v) => v.status === "CONFLICTO").length;
      const productIds = new Set(dbProducts.map((p) => p.id));

      for (const v of dbVersions) {
        if (!productIds.has(v.productId)) {
          throw new Error("post-write orphan version → rollback");
        }
      }

      let activeOk = 0;
      for (const p of dbProducts) {
        if (!p.activeVersionId) continue;
        const v = dbVersions.find((x) => x.id === p.activeVersionId);
        if (v && v.status === "VIGENTE" && v.productId === p.id) activeOk += 1;
      }

      if (versionCount !== meta.expectedVersions) {
        throw new Error(
          `post-write versions=${versionCount} expected=${meta.expectedVersions} → rollback`
        );
      }
      if (vigentes !== meta.expectedActive || activeOk !== meta.expectedActive) {
        throw new Error(
          `post-write vigentes/active=${vigentes}/${activeOk} expected=${meta.expectedActive} → rollback`
        );
      }
      if (historicas !== store.versions.filter((v) => v.status === "HISTORICA").length) {
        throw new Error("post-write historicas mismatch → rollback");
      }
      if (conflictos !== 0) {
        throw new Error("post-write conflictos!=0 → rollback");
      }

      await tx.insert(formulaImportRuns).values({
        id: importRunId,
        sourceArchiveHash: meta.archiveHash,
        startedAt: new Date(),
        completedAt: new Date(),
        status: "COMPLETED",
        filesScanned: meta.filesScanned,
        formulasDetected: meta.formulasDetected,
        inserted: versionCount,
        duplicated: meta.duplicated,
        warnings: [],
        errors: [],
      });

      return {
        counts: {
          versions: versionCount,
          vigentes,
          historicas,
          conflictos,
          pendingClients: 0,
          reviewRequired: 0,
          activeProducts: activeOk,
          products: dbProducts.length,
        } satisfies SafeImportCounts,
        importRunId,
      };
    });

    return result;
  } finally {
    await pool.end();
  }
}

/** Registra un run FAILED fuera de la transacción de reemplazo (no afecta el banco). */
export async function cliRecordFailedImportRun(input: {
  archiveHash: string;
  filesScanned: number;
  formulasDetected: number;
  duplicated: number;
  errors: string[];
}): Promise<string> {
  const pool = createCliPool();
  const id = randomUUID();
  try {
    const db = drizzle(pool);
    await db.insert(formulaImportRuns).values({
      id,
      sourceArchiveHash: input.archiveHash,
      startedAt: new Date(),
      completedAt: new Date(),
      status: "FAILED",
      filesScanned: input.filesScanned,
      formulasDetected: input.formulasDetected,
      inserted: 0,
      duplicated: input.duplicated,
      warnings: [],
      errors: input.errors,
    });
    return id;
  } finally {
    await pool.end();
  }
}

/** @deprecated Prefer cliPersistFormulaBankAtomic. Kept for type compatibility. */
export async function cliPersistFormulaBank(store: MemoryFormulaBank): Promise<void> {
  await cliPersistFormulaBankAtomic(store, {
    archiveHash: "legacy-non-atomic",
    filesScanned: 0,
    formulasDetected: store.versions.length,
    duplicated: 0,
    expectedVersions: store.versions.length,
    expectedActive: countSafeBank(store).activeProducts,
  });
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
  if (input.status === "FAILED") {
    return cliRecordFailedImportRun({
      archiveHash: input.archiveHash,
      filesScanned: input.filesScanned,
      formulasDetected: input.formulasDetected,
      duplicated: input.duplicated,
      errors: input.errors ?? [],
    });
  }
  const pool = createCliPool();
  const id = randomUUID();
  try {
    const db = drizzle(pool);
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
  } finally {
    await pool.end();
  }
}
