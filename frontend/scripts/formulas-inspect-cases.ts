/**
 * Inspección LOCAL y read-only de casos borde (CONFLICTO / REVIEW / CLIENTE_PENDIENTE)
 * + auditoría de conteos reconciliada.
 *
 * NO importa, NO usa DATABASE_URL, NO toca Preview/Production.
 * Imprime SOLO metadatos (archivo, ruta, hoja, cliente, producto, sourceConfidence,
 * fecha, estado, motivo). NUNCA ingredientes, porcentajes, cantidades ni procedimientos.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { parseWorkbookBuffer } from "../src/lib/formulas/parse-workbook";
import { isPendingClient, normalizeSearchKey, shouldIgnoreArchiveEntry } from "../src/lib/formulas/types";
import { FormulaBankService, MemoryFormulaBank } from "../src/lib/formulas/formula-bank-service";

function walkFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, acc);
    else acc.push(p);
  }
  return acc;
}

function folderClientHint(filePath: string, root: string): string {
  const rel = filePath.slice(root.length + 1);
  const parts = rel.split(/[\\/]/).filter(Boolean);
  return parts.length >= 3 ? parts[1]! : "";
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}
function dirName(p: string): string {
  const parts = p.split(/[\\/]/);
  parts.pop();
  return parts.join("/");
}

function main() {
  const argv = process.argv.slice(2);
  let input = "";
  for (let i = 0; i < argv.length; i++) if (argv[i] === "--input") input = argv[i + 1] ?? "";
  if (!input || !existsSync(input)) {
    console.error("Uso: tsx scripts/formulas-inspect-cases.ts --input /ruta/privada.zip");
    process.exit(2);
  }

  const archiveHash = createHash("sha256").update(readFileSync(input)).digest("hex");
  const dest = join(tmpdir(), `genus-inspect-${archiveHash.slice(0, 10)}`);
  mkdirSync(dest, { recursive: true });
  execFileSync("unzip", ["-qq", "-o", input, "-d", dest], { stdio: "ignore" });

  const files = walkFiles(dest);
  const knownClients = [
    ...new Set(files.map((f) => folderClientHint(f, dest)).filter(Boolean)),
  ];
  const allDrafts = [] as ReturnType<typeof parseWorkbookBuffer>;
  for (const file of files) {
    const st = statSync(file);
    const rel = file.slice(dest.length + 1);
    if (shouldIgnoreArchiveEntry(rel, st.size)) continue;
    allDrafts.push(
      ...parseWorkbookBuffer(readFileSync(file), {
        sourceFile: rel,
        sourceModifiedAt: st.mtime.toISOString(),
        folderClient: folderClientHint(file, dest),
        knownClients,
      })
    );
  }

  // Clientes confiables detectados (para posible resolución por filename).
  const knownClientMap = new Map<string, string>(); // normalizado -> display
  for (const d of allDrafts) {
    if (!isPendingClient(d.displayClient)) {
      knownClientMap.set(normalizeSearchKey(d.displayClient), d.displayClient);
    }
  }

  // Ingesta en banco fresco (en memoria; no persiste nada).
  const bank = new MemoryFormulaBank();
  const svc = new FormulaBankService(bank);
  svc.ingestDrafts(allDrafts, {});

  const draftByHash = new Map(allDrafts.map((d) => [`${d.sourceHash}`, d]));

  // ---------- CONFLICTOS ----------
  const conflictProductIds = new Set(
    bank.versions.filter((v) => v.status === "CONFLICTO").map((v) => v.productId)
  );
  const conflicts = [...conflictProductIds].map((pid) => {
    const prod = bank.products.find((p) => p.id === pid)!;
    const vers = bank.versions.filter((v) => v.productId === pid);
    return {
      client: prod.displayClient,
      product: prod.displayProduct,
      productCode: prod.productCode || "(sin código)",
      normalizedIdentity: `${prod.normalizedClient} || ${prod.normalizedProduct}`,
      versions: vers.map((v) => ({
        file: baseName(v.sourceFile ?? ""),
        path: dirName(v.sourceFile ?? ""),
        sheet: v.sourceSheet,
        sourceConfidence: v.sourceConfidence,
        sourceModifiedAt: v.sourceModifiedAt,
        status: v.status,
        semanticHashPrefix: v.semanticHash.slice(0, 12),
        altSourceFiles: v.altSourcePaths.map(baseName),
      })),
      semanticIdentical:
        new Set(vers.map((v) => v.semanticHash)).size === 1,
      sameModifiedAt: new Set(vers.map((v) => v.sourceModifiedAt)).size === 1,
      sameCode: new Set(vers.map(() => prod.productCode)).size === 1,
    };
  });

  // ---------- REVIEW_REQUIRED ----------
  const reviews = allDrafts
    .filter((d) => d.reviewRequired)
    .map((d) => ({
      file: baseName(d.sourceFile),
      path: dirName(d.sourceFile),
      sheet: d.sourceSheet,
      client: d.displayClient,
      product: d.displayProduct,
      sourceConfidence: d.sourceConfidence,
      sourceModifiedAt: d.sourceModifiedAt,
      status: "REVIEW_REQUIRED",
      reviewReasons: d.reviewReasons,
      expressionType: d.expressionType,
      percentageSource: d.percentageSource,
      nIngredients: d.ingredients.length,
      nIngredientsWithPct: d.ingredients.filter((i) => i.percentage != null).length,
      nIngredientsWithQty: d.ingredients.filter((i) => i.sourceQuantity != null).length,
      procedureSteps: d.procedureSteps.length,
    }));

  // ---------- CLIENTE_PENDIENTE ----------
  const clientPendings = allDrafts
    .filter((d) => isPendingClient(d.displayClient))
    .map((d) => {
      // ¿Coincide algún cliente conocido dentro del nombre de archivo? (evidencia)
      const fileNorm = normalizeSearchKey(baseName(d.sourceFile));
      const matches = [...knownClientMap.entries()]
        .filter(([nc]) => {
          const toks = nc.split(" ").filter(Boolean);
          return toks.length > 0 && toks.every((t) => fileNorm.includes(t));
        })
        .map(([, disp]) => disp);
      return {
        file: baseName(d.sourceFile),
        path: dirName(d.sourceFile),
        sheet: d.sourceSheet,
        clientReason: "sin 2º segmento de carpeta (archivo en raíz del ZIP) y sin celda Cliente",
        product: d.displayProduct,
        sourceConfidence: d.sourceConfidence,
        sourceModifiedAt: d.sourceModifiedAt,
        status: "CLIENTE_PENDIENTE",
        knownClientTokenMatchesInFilename: matches,
      };
    });

  // ---------- AUDITORÍA DE CONTEOS (partición sin doble conteo) ----------
  // Representante único por semanticHash = el que recibió versión.
  const versionHashes = new Set(bank.versions.map((v) => v.semanticHash));
  const total = allDrafts.length;
  const inserted = bank.versions.length;
  const duplicated = total - inserted;

  // Partición de las 'inserted' versiones con prioridad: CONFLICT > REVIEW > CLIENT_PENDING > VIGENTE > HISTORICA
  let cConflict = 0,
    cReview = 0,
    cClientPending = 0,
    cVigente = 0,
    cHistorica = 0;
  for (const v of bank.versions) {
    const d = draftByHash.get(v.sourceHash);
    const review = v.reviewRequired || d?.reviewRequired;
    const clientPending = isPendingClient(
      bank.products.find((p) => p.id === v.productId)?.displayClient ?? ""
    );
    if (v.status === "CONFLICTO") cConflict++;
    else if (review) cReview++;
    else if (clientPending) cClientPending++;
    else if (v.status === "VIGENTE") cVigente++;
    else cHistorica++;
  }

  // Productos con vigente limpia (aptos para crear OE).
  const productsActiveClean = bank.products.filter((p) => {
    if (!p.activeVersionId) return false;
    if (isPendingClient(p.displayClient)) return false;
    const v = bank.versions.find((x) => x.id === p.activeVersionId);
    if (!v || v.status !== "VIGENTE") return false;
    if (v.reviewRequired) return false;
    return true;
  }).length;

  const audit = {
    detectadas_total: total,
    duplicadas_omitidas: duplicated,
    insertadas_como_version: inserted,
    particion_sin_doble_conteo: {
      bloqueadas_por_conflicto: cConflict,
      bloqueadas_por_review: cReview,
      bloqueadas_por_cliente_pendiente: cClientPending,
      importables_como_vigente: cVigente,
      importables_como_historica: cHistorica,
    },
    check_suma:
      duplicated + cConflict + cReview + cClientPending + cVigente + cHistorica,
    neon_insertaria_real_bajo_gate_seguro: cVigente + cHistorica,
    productos_activos_para_OE: productsActiveClean,
    versionHashesDistintos: versionHashes.size,
  };

  console.log(
    JSON.stringify({ conflicts, reviews, clientPendings, audit }, null, 2)
  );
}

main();
