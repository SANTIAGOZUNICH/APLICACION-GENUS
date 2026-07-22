/**
 * Diagnóstico LOCAL y read-only del parser de fórmulas.
 * NO toca base de datos, NO importa, NO escribe fórmulas/ingredientes en el repo.
 * Uso: npm run formulas:diagnose -- --input /ruta/privada.zip
 *
 * La consola solo muestra AGREGADOS numéricos. El detalle por-archivo (que puede
 * contener nombres reales) se escribe únicamente a %TEMP%.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { parseWorkbookBuffer } from "../src/lib/formulas/parse-workbook";
import { isPendingClient, shouldIgnoreArchiveEntry } from "../src/lib/formulas/types";

function walkFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, acc);
    else acc.push(p);
  }
  return acc;
}

/** Cliente = 2º segmento de la ruta dentro del ZIP (la carpeta raíz NO es cliente). */
function folderClientHint(filePath: string, root: string): string {
  const rel = filePath.slice(root.length + 1);
  const parts = rel.split(/[\\/]/).filter(Boolean);
  return parts.length >= 3 ? parts[1]! : "";
}

function bump(map: Record<string, number>, key: string, n = 1) {
  map[key] = (map[key] ?? 0) + n;
}

function main() {
  const argv = process.argv.slice(2);
  let input = "";
  for (let i = 0; i < argv.length; i++) if (argv[i] === "--input") input = argv[i + 1] ?? "";
  if (!input || !existsSync(input)) {
    console.error("Uso: npm run formulas:diagnose -- --input /ruta/privada.zip");
    process.exit(2);
  }

  const archiveHash = createHash("sha256").update(readFileSync(input)).digest("hex");
  const dest = join(tmpdir(), `genus-diagnose-${archiveHash.slice(0, 10)}`);
  mkdirSync(dest, { recursive: true });
  execFileSync("unzip", ["-qq", "-o", input, "-d", dest], { stdio: "ignore" });

  const files = walkFiles(dest);
  const knownClients = [
    ...new Set(files.map((f) => folderClientHint(f, dest)).filter(Boolean)),
  ];

  let filesScannedExcel = 0;
  let filesIgnored = 0;
  const distinctFiles = new Set<string>();
  const distinctClients = new Set<string>();

  const productSource: Record<string, number> = {};
  const expressionType: Record<string, number> = {};
  const percentageSource: Record<string, number> = {};
  const reviewReasons: Record<string, number> = {};
  let pendingClient = 0;
  let pendingProduct = 0;
  let reviewRequired = 0;
  let importable = 0;
  let totalDrafts = 0;

  const detail: unknown[] = [];

  for (const file of files) {
    const st = statSync(file);
    const rel = file.slice(dest.length + 1);
    if (shouldIgnoreArchiveEntry(rel, st.size)) {
      filesIgnored += 1;
      continue;
    }
    filesScannedExcel += 1;
    const drafts = parseWorkbookBuffer(readFileSync(file), {
      sourceFile: rel,
      sourceModifiedAt: st.mtime.toISOString(),
      folderClient: folderClientHint(file, dest),
      knownClients,
    });

    for (const d of drafts) {
      totalDrafts += 1;
      distinctFiles.add(d.sourceFile);
      if (!isPendingClient(d.displayClient)) distinctClients.add(d.displayClient);

      bump(productSource, d.sourceConfidence ?? "UNKNOWN");
      bump(expressionType, d.expressionType ?? "UNKNOWN");
      bump(percentageSource, d.percentageSource ?? "UNKNOWN");

      const clientPending = isPendingClient(d.displayClient);
      const productPending = d.sourceConfidence === "PENDING";
      if (clientPending) pendingClient += 1;
      if (productPending) pendingProduct += 1;
      if (d.reviewRequired) {
        reviewRequired += 1;
        for (const r of d.reviewReasons ?? []) bump(reviewReasons, r);
      }
      if (!d.reviewRequired && !productPending && !clientPending) importable += 1;

      detail.push({
        file: d.sourceFile,
        sheet: d.sourceSheet,
        displayClient: d.displayClient,
        displayProduct: d.displayProduct,
        sourceConfidence: d.sourceConfidence,
        expressionType: d.expressionType,
        percentageSource: d.percentageSource,
        percentageTotal: d.percentageTotal,
        originalPercentageTotal: d.originalPercentageTotal,
        reviewRequired: d.reviewRequired,
        reviewReasons: d.reviewReasons,
        nIngredients: d.ingredients.length,
      });
    }
  }

  const outFile = join(dest, "_diagnose_detail.json");
  writeFileSync(outFile, JSON.stringify(detail, null, 2), "utf8");

  const report = {
    archiveSha256Prefix: archiveHash.slice(0, 12),
    filesTotal: files.length,
    filesScannedExcel,
    filesIgnored,
    distinctFilesWithFormulas: distinctFiles.size,
    formulasDetected: totalDrafts,
    distinctClients: distinctClients.size,
    pendingClient,
    pendingProduct,
    productSource,
    expressionType,
    percentageSource,
    reviewRequired,
    reviewReasons,
    importable,
    detalleCompletoEn: outFile,
  };
  console.log(JSON.stringify(report, null, 2));
}

main();
