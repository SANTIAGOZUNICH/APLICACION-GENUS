/**
 * Parser de hojas OE → borrador de fórmula (sin kilos fijos de producción).
 * Usado por el importador privado y por tests sintéticos.
 *
 * Reglas clave:
 *  - Cliente: celda "Cliente" → carpeta (2º segmento del ZIP) → CLIENTE_PENDIENTE.
 *  - Producto: celda etiquetada → nombre de hoja válido → nombre de archivo → PENDIENTE.
 *  - Porcentajes: si suman ~100 se conservan; si suman ~1 se interpretan como
 *    proporción y se multiplican por 100; si están vacíos/ inválidos y hay columna
 *    de kg/cantidad válida se derivan (porcentaje_i = cantidad_i / Σcantidades × 100).
 *  - Fuera de tolerancia (98–102) o cantidades inválidas → reviewRequired.
 */

import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import {
  buildSemanticHashPayload,
  CLIENT_PENDING,
  deriveProductFromFilename,
  isGenericSheetName,
  looksLikeFieldLabel,
  matchesKnownClient,
  normalizeSearchKey,
  parseLooseNumber,
  PRODUCT_PENDING,
  resolveClientFromFilename,
  type ExpressionType,
  type ParsedFormulaDraft,
  type PercentageSource,
  type SourceConfidence,
} from "./types";

const PCT_LO = 98;
const PCT_HI = 102;
const PROP_LO = 0.98;
const PROP_HI = 1.02;

const QTY_HEADER_TOKENS = [
  "kg a pesar",
  "kg",
  "kilos",
  "kilo",
  "cantidad",
  "peso",
  "gramos",
  "grs",
  "unidad",
  "litro",
  "lts",
];

function cellStr(v: unknown): string {
  if (v == null) return "";
  return String(v).replace(/\u00a0/g, " ").trim();
}

function round6(n: number): number {
  return Number(n.toFixed(6));
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

function isNumericOnly(raw: string): boolean {
  return /^\d+([.,]\d+)?$/.test(raw.replace(/\s/g, ""));
}

/**
 * Busca el valor de una etiqueta: primero a la derecha, si no, debajo.
 * Descarta candidatos que parecen otra etiqueta (evita saltar a un campo hermano
 * cuando la celda de valor está vacía) y, opcionalmente, valores numéricos puros.
 */
function findLabelValue(
  matrix: string[][],
  labels: string[],
  opts?: { rejectNumeric?: boolean }
): string {
  const norms = labels.map((l) => normalizeSearchKey(l));
  const isBad = (raw: string) =>
    looksLikeFieldLabel(raw) || (opts?.rejectNumeric === true && isNumericOnly(raw));
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r]!;
    for (let i = 0; i < row.length; i++) {
      const key = normalizeSearchKey(row[i] ?? "");
      if (!key) continue;
      if (norms.some((n) => key === n || key.startsWith(n + " "))) {
        const right = row.slice(i + 1).find((c) => cellStr(c));
        if (right && !isBad(cellStr(right))) return cellStr(right);
        const below = cellStr(matrix[r + 1]?.[i]);
        if (below && !isBad(below)) return below;
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

type RawRow = {
  materialName: string;
  materialCodeOrPhase: string;
  rawPct: number | null;
  rawQty: number | null;
};

function extractRawRows(matrix: string[][], headerRow: number) {
  const header = matrix[headerRow]!.map((c) => normalizeSearchKey(c));
  const idxName = header.findIndex((h) => h.includes("materia prima"));
  const idxCode = header.findIndex(
    (h) => h.includes("codigo") || h.includes("fase") || h === "cod"
  );
  const idxPct = header.findIndex((h) => h.includes("formula") || h === "%" || h.includes("%"));
  const idxQty = header.findIndex(
    (h, i) => i !== idxPct && QTY_HEADER_TOKENS.some((t) => h.includes(t))
  );
  const rows: RawRow[] = [];
  if (idxName < 0) return { rows, idxPct, idxQty };
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r]!;
    const name = cellStr(row[idxName]);
    if (!name) continue;
    const lower = normalizeSearchKey(name);
    if (lower.includes("procedimiento") || lower.includes("total") || lower.includes("especific")) {
      break;
    }
    rows.push({
      materialName: name,
      materialCodeOrPhase: idxCode >= 0 ? cellStr(row[idxCode]) : "",
      rawPct: idxPct >= 0 ? parseLooseNumber(row[idxPct]) : null,
      rawQty: idxQty >= 0 ? parseLooseNumber(row[idxQty]) : null,
    });
  }
  return { rows, idxPct, idxQty };
}

type ClassifiedFormula = {
  ingredients: ParsedFormulaDraft["ingredients"];
  expressionType: ExpressionType;
  percentageSource: PercentageSource;
  percentageTotal: number | null;
  originalPercentageTotal: number | null;
  reviewReasons: string[];
};

/**
 * Clasifica y deriva porcentajes según reglas de % / proporción / cantidad.
 */
function classifyFormula(rows: RawRow[], hasQtyCol: boolean): ClassifiedFormula {
  const pctVals = rows.map((r) => r.rawPct).filter((n): n is number => n != null);
  const qtyVals = rows.map((r) => r.rawQty).filter((n): n is number => n != null);
  const sumPct = pctVals.reduce((a, b) => a + b, 0);
  const sumQty = qtyVals.reduce((a, b) => a + b, 0);
  const anyQtyNeg = rows.some((r) => r.rawQty != null && r.rawQty < 0);
  const originalPercentageTotal = pctVals.length ? round6(sumPct) : null;

  let expressionType: ExpressionType = "PERCENTAGE";
  let percentageSource: PercentageSource = "ORIGINAL";
  const reviewReasons: string[] = [];
  let finalPct: (number | null)[];

  const pctOriginalOk = pctVals.length > 0 && sumPct >= PCT_LO && sumPct <= PCT_HI;
  const pctProportion = pctVals.length > 0 && sumPct >= PROP_LO && sumPct <= PROP_HI;
  const qtyUsable = qtyVals.length > 0 && sumQty > 0 && !anyQtyNeg;

  if (pctOriginalOk) {
    expressionType = "PERCENTAGE";
    percentageSource = "ORIGINAL";
    finalPct = rows.map((r) => (r.rawPct == null ? null : round6(r.rawPct)));
  } else if (pctProportion) {
    expressionType = "PERCENTAGE";
    percentageSource = "PROPORTION_SCALED";
    finalPct = rows.map((r) => (r.rawPct == null ? null : round6(r.rawPct * 100)));
  } else if (hasQtyCol && qtyUsable) {
    expressionType = "QUANTITY";
    percentageSource = "DERIVED_FROM_QUANTITY";
    finalPct = rows.map((r) => (r.rawQty == null ? null : round6((r.rawQty / sumQty) * 100)));
  } else if (hasQtyCol) {
    // Columna de cantidad presente pero no utilizable.
    expressionType = "QUANTITY";
    percentageSource = "DERIVED_FROM_QUANTITY";
    finalPct = rows.map(() => null);
    if (anyQtyNeg) reviewReasons.push("QUANTITY_NEGATIVE");
    if (qtyVals.length === 0) reviewReasons.push("QUANTITY_NON_NUMERIC");
    else if (sumQty <= 0) reviewReasons.push("QUANTITY_SUM_ZERO");
  } else {
    // Solo columna porcentual, fuera de tolerancia y no es proporción → incompleta.
    expressionType = "PERCENTAGE";
    percentageSource = "ORIGINAL";
    finalPct = rows.map((r) => (r.rawPct == null ? null : round6(r.rawPct)));
    if (pctVals.length === 0) reviewReasons.push("NO_NUMERIC_COLUMN");
    else reviewReasons.push("PCT_TOTAL_OUT_OF_TOLERANCE");
  }

  const finalNums = finalPct.filter((n): n is number => n != null);
  const percentageTotal = finalNums.length
    ? round6(finalNums.reduce((a, b) => a + b, 0))
    : null;

  // Validación de tolerancia final para caminos de % (no derivados).
  if (
    percentageSource !== "DERIVED_FROM_QUANTITY" &&
    percentageTotal != null &&
    (percentageTotal < PCT_LO || percentageTotal > PCT_HI) &&
    !reviewReasons.includes("PCT_TOTAL_OUT_OF_TOLERANCE")
  ) {
    reviewReasons.push("PCT_TOTAL_OUT_OF_TOLERANCE");
  }

  const ingredients = rows.map((r, i) => ({
    position: i + 1,
    materialName: r.materialName,
    materialCodeOrPhase: r.materialCodeOrPhase,
    percentage: finalPct[i] ?? null,
    sourceQuantity: r.rawQty,
    notes: "",
  }));

  return {
    ingredients,
    expressionType,
    percentageSource,
    percentageTotal,
    originalPercentageTotal,
    reviewReasons,
  };
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

function resolveProduct(
  matrix: string[][],
  sheetName: string,
  sourceFile: string,
  knownClient: string
): { displayProduct: string; sourceConfidence: SourceConfidence } {
  const cellVal = findLabelValue(matrix, ["Producto", "Product", "Nombre"], {
    rejectNumeric: true,
  });
  if (cellVal) return { displayProduct: cellVal, sourceConfidence: "CELL" };

  if (sheetName && !isGenericSheetName(sheetName)) {
    return { displayProduct: sheetName.trim(), sourceConfidence: "SHEET" };
  }

  const fromFile = deriveProductFromFilename(sourceFile, knownClient);
  if (fromFile) return { displayProduct: fromFile, sourceConfidence: "FILENAME" };

  return { displayProduct: PRODUCT_PENDING, sourceConfidence: "PENDING" };
}

export function parseWorkbookBuffer(
  buffer: Buffer,
  meta: {
    sourceFile: string;
    sourceModifiedAt: string | null;
    folderClient?: string;
    knownClients?: string[];
  }
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
    const { rows, idxQty } = headerRow >= 0
      ? extractRawRows(matrix, headerRow)
      : { rows: [] as RawRow[], idxQty: -1 };
    const procedureSteps = extractProcedure(matrix);
    // Una fórmula requiere ingredientes; hojas sin materia prima (p.ej. solo
    // procedimiento) no representan una fórmula importable.
    if (rows.length === 0) continue;

    // Cliente: CELL → FOLDER → FILENAME → CLIENTE_PENDIENTE.
    // La celda "Cliente" de la plantilla es ruidosa (puede traer "Envase…", etc.),
    // por eso solo se acepta si coincide con un cliente conocido (carpetas del ZIP).
    // No se inventa: sin evidencia confiable queda pendiente.
    const knownClients = meta.knownClients ?? [];
    const cellClient = findLabelValue(matrix, ["Cliente", "Client"], { rejectNumeric: true });
    let displayClient = "";
    if (cellClient && matchesKnownClient(cellClient, knownClients)) {
      displayClient = cellClient;
    }
    if (!displayClient.trim() && meta.folderClient?.trim()) {
      displayClient = meta.folderClient.trim();
    }
    if (!displayClient.trim()) {
      displayClient = resolveClientFromFilename(meta.sourceFile, knownClients);
    }
    if (!displayClient.trim()) displayClient = CLIENT_PENDING;

    const { displayProduct, sourceConfidence } = resolveProduct(
      matrix,
      sheetName,
      meta.sourceFile,
      displayClient
    );

    const classified = classifyFormula(rows, idxQty >= 0);
    const productCode = findLabelValue(matrix, ["Código", "Codigo", "Code"]);

    const warnings: string[] = [];
    if (displayClient === CLIENT_PENDING) warnings.push("Cliente no determinado");
    if (sourceConfidence === "PENDING") warnings.push("Producto no determinado");
    if (procedureSteps.length === 0) warnings.push("Procedimiento faltante");

    const reviewReasons = [...classified.reviewReasons];
    const reviewRequired = reviewReasons.length > 0;

    const semanticHash = createHash("sha256")
      .update(
        buildSemanticHashPayload({
          displayClient,
          displayProduct,
          ingredients: classified.ingredients,
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
      ingredients: classified.ingredients,
      procedureSteps,
      specifications: [],
      percentageTotal: classified.percentageTotal,
      originalPercentageTotal: classified.originalPercentageTotal,
      warnings,
      altSourcePaths: [],
      sourceConfidence,
      expressionType: classified.expressionType,
      percentageSource: classified.percentageSource,
      reviewRequired,
      reviewReasons,
    });
  }
  return drafts;
}
