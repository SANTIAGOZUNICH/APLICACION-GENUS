/**
 * CLI privado: scan / import de ZIP de fórmulas.
 * Ejecutar vía: npm run formulas:scan -- --input /ruta.zip
 * No imprime fórmulas completas ni ingredientes en logs generales.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { parseWorkbookBuffer } from "../src/lib/formulas/parse-workbook";
import {
  isPendingClient,
  looksLikeCopyName,
  shouldIgnoreArchiveEntry,
} from "../src/lib/formulas/types";
import {
  formulaBankService,
  memoryFormulaBank,
} from "../src/lib/formulas/formula-bank-service";

function archiveSha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function walkFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, acc);
    else acc.push(p);
  }
  return acc;
}

/**
 * Cliente = 2º segmento de la ruta dentro del ZIP (la carpeta raíz NO es cliente).
 * Solo se usa si existe un directorio de cliente real por encima del archivo.
 */
function folderClientHint(filePath: string, root: string): string {
  const rel = filePath.slice(root.length + 1);
  const parts = rel.split(/[\\/]/).filter(Boolean);
  return parts.length >= 3 ? parts[1]! : "";
}

function countBy<T extends string>(items: (T | undefined)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const k = it ?? "UNKNOWN";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function summarizeDrafts(allDrafts: ReturnType<typeof parseWorkbookBuffer>) {
  const totalsOff = allDrafts.filter(
    (d) => d.percentageTotal != null && Math.abs(d.percentageTotal - 100) > 0.05
  ).length;
  const reviewReasons: Record<string, number> = {};
  for (const d of allDrafts) {
    if (!d.reviewRequired) continue;
    for (const reason of d.reviewReasons ?? []) {
      reviewReasons[reason] = (reviewReasons[reason] ?? 0) + 1;
    }
  }
  const pendingProduct = allDrafts.filter((d) => d.sourceConfidence === "PENDING").length;
  const pendingClient = allDrafts.filter((d) => isPendingClient(d.displayClient)).length;
  const reviewRequired = allDrafts.filter((d) => d.reviewRequired).length;
  const importable = allDrafts.filter(
    (d) =>
      !d.reviewRequired &&
      d.sourceConfidence !== "PENDING" &&
      !isPendingClient(d.displayClient)
  ).length;
  return {
    formulasDetected: allDrafts.length,
    copyNamedFiles: allDrafts.filter((d) => looksLikeCopyName(d.sourceFile)).length,
    warningCount: allDrafts.reduce((a, d) => a + d.warnings.length, 0),
    pendingClient,
    pendingProduct,
    productSource: countBy(allDrafts.map((d) => d.sourceConfidence)),
    expressionType: countBy(allDrafts.map((d) => d.expressionType)),
    percentageSource: countBy(allDrafts.map((d) => d.percentageSource)),
    percentageTotalOff100: totalsOff,
    reviewRequired,
    reviewReasons,
    importable,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const mode = argv.includes("import") ? "import" : "scan";
  let input = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input") input = argv[i + 1] ?? "";
  }

  if (!input) {
    console.error("Uso: npm run formulas:scan -- --input /ruta/privada.zip");
    process.exit(2);
  }
  if (!existsSync(input)) {
    console.error(`Archivo no encontrado: ${input}`);
    console.error("Colocá el ZIP fuera del repo, p.ej. /tmp/private-formulas/ORDEN....zip");
    process.exit(2);
  }

  const archiveHash = archiveSha256(input);
  console.log(`[formulas:${mode}] archiveSha256=${archiveHash.slice(0, 12)}…`);

  const dest = join(tmpdir(), `genus-formulas-${archiveHash.slice(0, 10)}`);
  mkdirSync(dest, { recursive: true });
  execFileSync("unzip", ["-qq", "-o", input, "-d", dest], { stdio: "ignore" });

  const files = walkFiles(dest);
  const knownClients = [
    ...new Set(files.map((f) => folderClientHint(f, dest)).filter(Boolean)),
  ];
  let scanned = 0;
  let ignored = 0;
  const allDrafts = [];
  for (const file of files) {
    const st = statSync(file);
    const rel = file.slice(dest.length + 1);
    if (shouldIgnoreArchiveEntry(rel, st.size)) {
      ignored += 1;
      continue;
    }
    scanned += 1;
    const drafts = parseWorkbookBuffer(readFileSync(file), {
      sourceFile: rel,
      sourceModifiedAt: st.mtime.toISOString(),
      folderClient: folderClientHint(file, dest),
      knownClients,
    });
    allDrafts.push(...drafts);
  }

  const summary = {
    mode,
    filesTotal: files.length,
    filesScannedExcel: scanned,
    filesIgnored: ignored,
    ...summarizeDrafts(allDrafts),
  };
  console.log(JSON.stringify(summary, null, 2));

  memoryFormulaBank.reset();
  const result = formulaBankService.ingestDrafts(allDrafts, { archiveHash });
  console.log(
    JSON.stringify(
      {
        ingest: {
          inserted: result.inserted,
          duplicated: result.duplicated,
          conflicts: result.conflicts,
          warnings: result.warnings,
          products: result.products,
          vigentes: memoryFormulaBank.versions.filter((v) => v.status === "VIGENTE").length,
          historicas: memoryFormulaBank.versions.filter((v) => v.status === "HISTORICA").length,
          conflicto: memoryFormulaBank.versions.filter((v) => v.status === "CONFLICTO").length,
        },
      },
      null,
      2
    )
  );

  if (mode === "import") {
    const {
      isCliDatabaseConfigured,
      cliHasCompletedImport,
      cliPersistFormulaBank,
      cliRecordImportRun,
    } = await import("./formula-neon-io");

    if (!isCliDatabaseConfigured()) {
      console.error("import requiere DATABASE_URL (Neon Preview). Abortado.");
      process.exit(3);
    }

    if (await cliHasCompletedImport(archiveHash)) {
      console.log(
        JSON.stringify({
          import: "skipped",
          reason: "archive_already_imported",
          archiveSha256Prefix: archiveHash.slice(0, 12),
        })
      );
      return;
    }

    // Resultado ya ingestado en memoria arriba; persistir snapshot a Neon Preview.
    await cliPersistFormulaBank(memoryFormulaBank);
    await cliRecordImportRun({
      archiveHash,
      status: "COMPLETED",
      filesScanned: scanned,
      formulasDetected: allDrafts.length,
      inserted: result.inserted,
      duplicated: result.duplicated,
      warnings: [`warningCount=${result.warnings}`, `conflicts=${result.conflicts}`],
      errors: [],
    });
    console.log(
      JSON.stringify({
        import: "ok",
        persistedProducts: memoryFormulaBank.products.length,
        persistedVersions: memoryFormulaBank.versions.length,
        inserted: result.inserted,
        duplicated: result.duplicated,
        conflicts: result.conflicts,
        note: "Neon Preview only. No Production sin autorización explícita.",
      })
    );
  }
}

main().catch((err) => {
  console.error("[formulas]", err instanceof Error ? err.message : "error");
  process.exit(1);
});
