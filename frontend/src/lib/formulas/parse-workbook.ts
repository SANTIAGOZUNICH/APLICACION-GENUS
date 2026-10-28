/**
 * Parser de hojas OE → borrador de fórmula (sin kilos fijos de producción).
 * Usado por el importador privado y por tests sintéticos.
 *
 * Reglas clave:
 *  - Cliente: celda "Cliente" → carpeta (2º segmento del ZIP) → CLIENTE_PENDIENTE.
 *  - Producto: celda etiquetada → nombre de hoja válido → nombre de archivo → PENDIENTE.
 *  - Porcentajes: los de la hoja se conservan EXACTOS (solo se convierte la unidad si todos son
 *    fracciones de Excel: ×100). Nunca se normaliza a 100 %. Sin ningún % pero con cantidades
 *    completas se derivan (cantidad_i / Σcantidades × 100).
 *  - Fuera de tolerancia (98–102), filas sin % o cantidades inválidas → reviewRequired (no se usa en OE).
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
 * Clasifica los porcentajes de una fórmula SIN alterar su proporción. Regla de seguridad (fórmula aprobada):
 *  - Un porcentaje escrito en la hoja se conserva EXACTAMENTE; nunca se reescala para «llevar a 100 %» ni se completa por diferencia.
 *  - Única conversión permitida: unidades. Si TODAS las celdas son fracciones (formato % de Excel guarda 0,60 para «60 %»: máximo ≤ 1
 *    y suma ≤ 1,02) se multiplican por 100 — misma proporción, solo la unidad.
 *  - Si hay % pero el total queda fuera de 98–102 (p. ej. falta una fila, «c.s.p.» sin número), la fórmula queda en REVISIÓN
 *    (PCT_TOTAL_OUT_OF_TOLERANCE) y NO se usa para una OE; antes se recalculaba desde la columna de kg normalizando a 100 %, lo
 *    que inflaba todos los porcentajes (60 % → 71 %) y pasaba la validación porque el total daba 100.
 *  - Solo si la hoja NO tiene ningún % numérico y trae cantidades completas, el % se deriva de las cantidades (qty / Σqty); si alguna
 *    fila no tiene cantidad, no se deriva: revisión.
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

  const maxPct = pctVals.length ? Math.max(...pctVals) : 0;
  // Fracciones (formato % de Excel): todas ≤ 1 y suman entre 0,5 y 1,02. Solo cambia la unidad (×100), nunca la proporción.
  const pctAreFractions = pctVals.length > 0 && maxPct <= 1 && sumPct >= 0.5 && sumPct <= PROP_HI;
  const qtyComplete = hasQtyCol && qtyVals.length > 0 && qtyVals.length === rows.length && sumQty > 0 && !anyQtyNeg;

  if (pctVals.length > 0) {
    expressionType = "PERCENTAGE";
    if (pctAreFractions) {
      percentageSource = "PROPORTION_SCALED";
      finalPct = rows.map((r) => (r.rawPct == null ? null : round6(r.rawPct * 100)));
    } else {
      percentageSource = "ORIGINAL";
      finalPct = rows.map((r) => (r.rawPct == null ? null : round6(r.rawPct)));
    }
  } else if (qtyComplete) {
    expressionType = "QUANTITY";
    percentageSource = "DERIVED_FROM_QUANTITY";
    finalPct = rows.map((r) => (r.rawQty == null ? null : round6((r.rawQty / sumQty) * 100)));
  } else if (hasQtyCol) {
    // Sin % y con cantidades inutilizables o incompletas: no se deriva nada.
    expressionType = "QUANTITY";
    percentageSource = "DERIVED_FROM_QUANTITY";
    finalPct = rows.map(() => null);
    if (anyQtyNeg) reviewReasons.push("QUANTITY_NEGATIVE");
    if (qtyVals.length === 0) reviewReasons.push("QUANTITY_NON_NUMERIC");
    else if (sumQty <= 0) reviewReasons.push("QUANTITY_SUM_ZERO");
    else if (qtyVals.length !== rows.length) reviewReasons.push("QUANTITY_INCOMPLETE");
  } else {
    expressionType = "PERCENTAGE";
    percentageSource = "ORIGINAL";
    finalPct = rows.map(() => null);
    reviewReasons.push("NO_NUMERIC_COLUMN");
  }

  const finalNums = finalPct.filter((n): n is number => n != null);
  const percentageTotal = finalNums.length
    ? round6(finalNums.reduce((a, b) => a + b, 0))
    : null;

  // Los % de la hoja tienen que sumar ~100 (y todas las filas tener su %): si no, revisión humana (nunca se «arregla» sola).
  if (percentageSource !== "DERIVED_FROM_QUANTITY" && pctVals.length > 0) {
    if (percentageTotal != null && (percentageTotal < PCT_LO || percentageTotal > PCT_HI)) reviewReasons.push("PCT_TOTAL_OUT_OF_TOLERANCE");
    if (finalPct.some((p) => p == null)) reviewReasons.push("PCT_ROW_MISSING");
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
