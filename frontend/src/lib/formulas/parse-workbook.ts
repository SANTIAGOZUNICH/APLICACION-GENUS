/**
 * Parser de hojas OE → borrador de fórmula (sin kilos fijos).
 * Usado por el importador privado y por tests sintéticos.
 */

import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import {
  buildSemanticHashPayload,
  computePercentageTotal,
  normalizeSearchKey,
  type ParsedFormulaDraft,
} from "./types";

function cellStr(v: unknown): string {
  if (v == null) return "";
  return String(v).replace(/\u00a0/g, " ").trim();
}

function parsePct(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Excel a veces guarda 0.05 por 5%
    return raw > 0 && raw <= 1 ? Number((raw * 100).toFixed(6)) : raw;
  }
  const s = String(raw).replace("%", "").replace(",", ".").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function sheetLooksLikeOe(matrix: string[][]): boolean {
  const blob = matrix
    .slice(0, 40)
    .flat()
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const hasMp = blob.includes("materia prima");
  const hasPct = blob.includes("formula") && blob.includes("%");
  const hasProc = blob.includes("procedimiento");
  return hasMp && (hasPct || hasProc);
}

function findLabelValue(matrix: string[][], labels: string[]): string {
  const norms = labels.map((l) => normalizeSearchKey(l));
  for (const row of matrix) {
    for (let i = 0; i < row.length; i++) {
      const key = normalizeSearchKey(row[i] ?? "");
      if (norms.some((n) => key === n || key.startsWith(n + " "))) {
        const next = row.slice(i + 1).find((c) => cellStr(c));
        if (next) return cellStr(next);
      }
    }
  }
  return "";
}

function findHeaderRow(matrix: string[][]): number {
  for (let r = 0; r < Math.min(matrix.length, 60); r++) {
    const joined = matrix[r]!.map((c) => normalizeSearchKey(c)).join("|");
    if (joined.includes("materia prima") && (joined.includes("formula") || joined.includes("%"))) {
      return r;
    }
  }
  return -1;
}

function extractIngredients(matrix: string[][], headerRow: number) {
  const header = matrix[headerRow]!.map((c) => normalizeSearchKey(c));
  const idxName = header.findIndex((h) => h.includes("materia prima"));
  const idxCode = header.findIndex(
    (h) => h.includes("codigo") || h.includes("fase") || h === "cod"
  );
  const idxPct = header.findIndex((h) => h.includes("formula") || h === "%" || h.includes("%"));
  const out: ParsedFormulaDraft["ingredients"] = [];
  if (idxName < 0) return out;
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r]!;
    const name = cellStr(row[idxName]);
    if (!name) continue;
    const lower = normalizeSearchKey(name);
    if (lower.includes("procedimiento") || lower.includes("total") || lower.includes("especific")) {
      break;
    }
    const pct = idxPct >= 0 ? parsePct(row[idxPct]) : null;
    out.push({
      position: out.length + 1,
      materialName: name,
      materialCodeOrPhase: idxCode >= 0 ? cellStr(row[idxCode]) : "",
      percentage: pct,
      notes: "",
    });
  }
  return out;
}

function extractProcedure(matrix: string[][]): ParsedFormulaDraft["procedureSteps"] {
  const steps: ParsedFormulaDraft["procedureSteps"] = [];
  let start = -1;
  for (let r = 0; r < matrix.length; r++) {
    const joined = matrix[r]!.map((c) => normalizeSearchKey(c)).join(" ");
    if (joined.includes("procedimiento")) {
      start = r + 1;
      break;
    }
  }
  if (start < 0) return steps;
  for (let r = start; r < matrix.length; r++) {
    const text = matrix[r]!.map((c) => cellStr(c)).filter(Boolean).join(" — ");
    if (!text) continue;
    const low = normalizeSearchKey(text);
    if (low.includes("especificacion") || low.includes("control de calidad")) break;
    if (
      low.includes("cantidad kg") ||
      low.includes("kg a pesar") ||
      low.includes("ajuste") ||
      low.startsWith("lote") ||
      low.includes("fecha") ||
      low.includes("merma") ||
      low.includes("cantidad real")
    ) {
      continue; // no importar kilos/fechas/lotes como procedimiento
    }
    steps.push({ position: steps.length + 1, instruction: text });
  }
  return steps;
}

export function parseWorkbookBuffer(
  buffer: Buffer,
  meta: { sourceFile: string; sourceModifiedAt: string | null; folderClient?: string }
): ParsedFormulaDraft[] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const fileHash = createHash("sha256").update(buffer).digest("hex");
  const drafts: ParsedFormulaDraft[] = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
      header: 1,
      defval: "",
      raw: true,
    }) as unknown[][];
    const matrix = aoa.map((row) =>
      (Array.isArray(row) ? row : []).map((c) => cellStr(c))
    );
    if (!sheetLooksLikeOe(matrix)) continue;

    const headerRow = findHeaderRow(matrix);
    const ingredients = headerRow >= 0 ? extractIngredients(matrix, headerRow) : [];
    const procedureSteps = extractProcedure(matrix);
    if (ingredients.length === 0 && procedureSteps.length === 0) continue;

    let displayClient =
      findLabelValue(matrix, ["Cliente", "Client"]) ||
      meta.folderClient ||
      "";
    let displayProduct =
      findLabelValue(matrix, ["Producto", "Product", "Nombre"]) ||
      "";
    if (!displayProduct && sheetName && !/^hoja|sheet|oe$/i.test(sheetName.trim())) {
      displayProduct = sheetName.trim();
    }
    if (!displayClient) displayClient = "PENDIENTE";
    if (!displayProduct) displayProduct = "PENDIENTE";

    const productCode = findLabelValue(matrix, ["Código", "Codigo", "Code"]);
    const percentageTotal = computePercentageTotal(ingredients);
    const warnings: string[] = [];
    if (displayClient === "PENDIENTE") warnings.push("Cliente no determinado");
    if (displayProduct === "PENDIENTE") warnings.push("Producto no determinado");
    if (procedureSteps.length === 0) warnings.push("Procedimiento faltante");
    if (percentageTotal != null && Math.abs(percentageTotal - 100) > 0.05) {
      warnings.push(`Total porcentual ${percentageTotal} ≠ 100 (sin corregir)`);
    }

    const semanticHash = createHash("sha256")
      .update(
        buildSemanticHashPayload({
          displayClient,
          displayProduct,
          ingredients,
          procedureSteps,
        })
      )
      .digest("hex");

    drafts.push({
      displayClient,
      displayProduct,
      productCode,
      sourceFile: meta.sourceFile,
      sourceSheet: sheetName,
      sourceModifiedAt: meta.sourceModifiedAt,
      sourceHash: `${fileHash}:${sheetName}`,
      semanticHash,
      ingredients,
      procedureSteps,
      specifications: [],
      percentageTotal,
      warnings,
      altSourcePaths: [],
    });
  }
  return drafts;
}
