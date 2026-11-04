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

type Merge = { s: { r: number; c: number }; e: { r: number; c: number } };

/** Encabezados válidos de la columna de materia prima (cada planilla usa su propio rótulo). */
const NAME_HEADERS = ["materia prima", "materias primas", "ingrediente", "ingredientes", "componente", "componentes", "insumo", "insumos"];

const isPctHeader = (h: string) => h.includes("formula") || h.includes("porcentaje") || h.includes("%") || h === "pp" || h.includes("p p");
const isCodeHeader = (h: string) => h.includes("codigo") || h.includes("fase") || h === "cod";
const isQtyHeader = (h: string) => QTY_HEADER_TOKENS.some((t) => h.includes(t));

type TableLoc = {
  headerStart: number;
  headerEnd: number;
  nameCols: number[];
  codeCols: number[];
  pctCols: number[];
  qtyCols: number[];
};

/** Columnas que ocupa una celda de encabezado combinada (si no está combinada, solo la suya). */
function spanCols(merges: Merge[], r: number, c: number): number[] {
  const m = merges.find((x) => r >= x.s.r && r <= x.e.r && c >= x.s.c && c <= x.e.c);
  if (!m) return [c];
  const out: number[] = [];
  for (let k = m.s.c; k <= m.e.c; k++) out.push(k);
  return out;
}

const rowHasNumber = (row: string[]) => row.some((c) => /^\d+([.,]\d+)?\s*%?$/.test(cellStr(c).replace(/\s/g, "")));

/**
 * Ubica la tabla de materias primas SIN suponer una estructura fija: el encabezado puede estar en cualquier fila (primeras 80),
 * partido en 2–3 filas (p. ej. «Fórmula» arriba y «%» abajo), con celdas combinadas y con rótulos distintos
 * («Materia prima», «Ingrediente», «Componente»…).
 */
function locateTable(matrix: string[][], merges: Merge[]): { loc: TableLoc | null; why: string } {
  const norm = matrix.map((row) => row.map((c) => normalizeSearchKey(c)));
  let sawName = false;
  for (let r = 0; r < Math.min(matrix.length, 80); r++) {
    const row = norm[r]!;
    const nameC = row.findIndex((h) => h !== "" && NAME_HEADERS.some((t) => h === t || h.startsWith(t + " ") || h.endsWith(" " + t)));
    if (nameC < 0) continue;
    sawName = true;
    const pct = new Set<number>();
    const qty = new Set<number>();
    const code = new Set<number>();
    let headerStart = r;
    let headerEnd = r;
    for (let k = -2; k <= 2; k++) {
      const rr = r + k;
      if (rr < 0 || rr >= matrix.length) continue;
      // Las filas vecinas solo cuentan como encabezado si no tienen números (si no, ya son datos).
      if (k !== 0 && rowHasNumber(matrix[rr]!)) continue;
      norm[rr]!.forEach((h, c) => {
        if (!h || (rr === r && c === nameC)) return;
        const cols = spanCols(merges, rr, c);
        if (isPctHeader(h)) cols.forEach((x) => pct.add(x));
        else if (isCodeHeader(h)) cols.forEach((x) => code.add(x));
        else if (isQtyHeader(h)) cols.forEach((x) => qty.add(x));
        else return;
        headerStart = Math.min(headerStart, rr);
        headerEnd = Math.max(headerEnd, rr);
      });
    }
    pct.delete(nameC);
    qty.delete(nameC);
    code.delete(nameC);
    // Una columna no puede ser a la vez porcentaje y cantidad: si el rótulo es ambiguo gana el porcentaje.
    for (const c of pct) qty.delete(c);
    if (pct.size === 0 && qty.size === 0) continue;
    return {
      loc: {
        headerStart,
        headerEnd,
        nameCols: spanCols(merges, r, nameC),
        codeCols: [...code].sort((a, b) => a - b),
        pctCols: [...pct].sort((a, b) => a - b),
        qtyCols: [...qty].sort((a, b) => a - b),
      },
      why: "",
    };
  }
  return {
    loc: null,
    why: sawName
      ? "Se encontró la columna de materias primas pero no una columna de porcentaje («Fórmula %») ni de cantidades."
      : "No se encontró la tabla de materias primas (columna «Materia prima»).",
  };
}

type RawRow = {
  materialName: string;
  materialCodeOrPhase: string;
  rawPct: number | null;
  rawQty: number | null;
};

const firstNum = (row: string[], cols: number[]): number | null => {
  for (const c of cols) {
    const n = parseLooseNumber(row[c]);
    if (n != null) return n;
  }
  return null;
};
const firstText = (row: string[], cols: number[]): string => {
  for (const c of cols) {
    const t = cellStr(row[c]);
    if (t) return t;
  }
  return "";
};

/** Fin de la tabla: lo que sigue ya no son materias primas. */
const STOP_RE = /^(procedimiento|especificacion|control de (proceso|calidad)|firma|limpieza|observaciones? generales)/;
/** Filas de total/subtotal (el total final cierra la tabla; un subtotal intermedio de fase se omite). */
const TOTAL_RE = /^(total|subtotal|sub total|suma)\b/;
/** Títulos de fase/sección e instrucciones: no son ingredientes. */
const HEADING_RE = /^(fase|etapa|parte|grupo|seccion|nota|notas|obs|observacion|agregar|mezclar|pesar|calentar|disolver|incorporar|enfriar)\b/;

function extractRawRows(matrix: string[][], loc: TableLoc, merges: Merge[]) {
  const rows: RawRow[] = [];
  const skipped: string[] = [];
  const hasNumbers = (row: string[]) => firstNum(row, loc.pctCols) != null || firstNum(row, loc.qtyCols) != null;
  const nameOf = (row: string[]) => firstText(row, loc.nameCols);
  for (let r = loc.headerEnd + 1; r < matrix.length; r++) {
    const row = matrix[r]!;
    const name = nameOf(row);
    if (!name) continue; // fila intermedia vacía: no corta la tabla
    const lower = normalizeSearchKey(name);
    if (STOP_RE.test(lower) || lower.includes("procedimiento de elaboracion")) break;
    if (TOTAL_RE.test(lower)) {
      // ¿Siguen ingredientes con valores antes del cierre? Entonces era un subtotal de fase: se omite y se continúa.
      let more = false;
      for (let k = r + 1; k < matrix.length; k++) {
        const nx = matrix[k]!;
        const nn = nameOf(nx);
        const low = normalizeSearchKey(nn);
        if (nn && (STOP_RE.test(low) || low.includes("procedimiento de elaboracion"))) break;
        if (nn && !TOTAL_RE.test(low) && hasNumbers(nx)) { more = true; break; }
      }
      if (more) { skipped.push(name); continue; }
      break;
    }
    const pct = firstNum(row, loc.pctCols);
    const qty = firstNum(row, loc.qtyCols);
    const code = firstText(row, loc.codeCols);
    if (pct == null && qty == null) {
      // Sin ningún valor: título de fase, instrucción o nota (nunca un ingrediente inventado). Un ingrediente real sin % sigue
      // marcándose como faltante (revisión) salvo que su texto sea claramente un título.
      const spansTable = merges.some((m) => r >= m.s.r && r <= m.e.r && m.e.c > m.s.c && (loc.pctCols.length ? m.e.c >= loc.pctCols[0]! : true) && m.s.c <= loc.nameCols[0]!);
      const headingLike = HEADING_RE.test(lower) || /:\s*$/.test(name) || name.length > 70 || spansTable;
      if (headingLike) { skipped.push(name); continue; }
    }
    rows.push({ materialName: name, materialCodeOrPhase: code, rawPct: pct, rawQty: qty });
  }
  return { rows, skipped, hasQtyCol: loc.qtyCols.length > 0 };
}

type ClassifiedFormula = {
  ingredients: ParsedFormulaDraft["ingredients"];
  expressionType: ExpressionType;
  percentageSource: PercentageSource;
  percentageTotal: number | null;
  originalPercentageTotal: number | null;
  reviewReasons: string[];
  /** Avisos que NO bloquean (la fórmula se conserva tal cual): p. ej. la base de cálculo no es 100. */
  baseWarnings: string[];
};

/**
 * Clasifica los porcentajes de una fórmula SIN alterar su proporción. Regla de seguridad (fórmula aprobada):
 *  - Un porcentaje escrito en la hoja se conserva EXACTAMENTE; nunca se reescala para «llevar a 100 %» ni se completa por diferencia.
 *  - Única conversión permitida: unidades. Si TODAS las celdas son fracciones (formato % de Excel guarda 0,60 para «60 %»: máximo ≤ 1
 *    y suma ≤ 1,02) se multiplican por 100 — misma proporción, solo la unidad.
 *  - Si hay % pero el total queda fuera de 98–102, la fórmula NO se corrige: puede estar expresada en otra base de cálculo (kg cada
 *    100 L con el alcohol por densidad: 75 % v/v × 0,8 kg/L = 60; % v/v; etc.). Se conservan los valores aprobados y se agrega un
 *    AVISO (no bloquea el uso de la fórmula; la OE queda «pendiente de verificación» hasta que Producción/Dirección confirme base y
 *    cantidades). Antes se recalculaba desde la columna de kg normalizando a 100 %, lo que inflaba todos los porcentajes (60 → 71 %).
 *    Si además las cantidades de la hoja no son proporcionales a los % (la base es ambigua) → revisión (QUANTITY_PCT_MISMATCH).
 *  - Solo si la hoja NO tiene ningún % numérico y trae cantidades completas, el % se deriva de las cantidades (qty / Σqty); si alguna
 *    fila no tiene cantidad, no se deriva: revisión.
 */
function classifyFormula(inputRows: RawRow[], hasQtyCol: boolean): ClassifiedFormula {
  // Fila sin % pero con cantidad explícita 0 (p. ej. COLORANTE «0.000» kg): su aporte es 0, no un dato faltante.
  const hasAnyPct = inputRows.some((r) => r.rawPct != null && r.rawPct > 0);
  const rows = hasAnyPct ? inputRows.map((r) => (r.rawPct == null && r.rawQty === 0 ? { ...r, rawPct: 0 } : r)) : inputRows;
  const pctVals = rows.map((r) => r.rawPct).filter((n): n is number => n != null);
  const qtyVals = rows.map((r) => r.rawQty).filter((n): n is number => n != null);
  const sumPct = pctVals.reduce((a, b) => a + b, 0);
  const sumQty = qtyVals.reduce((a, b) => a + b, 0);
  const anyQtyNeg = rows.some((r) => r.rawQty != null && r.rawQty < 0);
  const originalPercentageTotal = pctVals.length ? round6(sumPct) : null;

  let expressionType: ExpressionType = "PERCENTAGE";
  let percentageSource: PercentageSource = "ORIGINAL";
  const reviewReasons: string[] = [];
  const baseWarnings: string[] = [];
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

  // Los % de la hoja se conservan SIEMPRE. Si no suman ~100 solo se avisa (otra base de cálculo); nunca se «arregla» sola.
  if (percentageSource !== "DERIVED_FROM_QUANTITY" && pctVals.length > 0) {
    if (finalPct.some((p) => p == null)) {
      reviewReasons.push("PCT_ROW_MISSING");
    } else if (percentageTotal != null && (percentageTotal < PCT_LO || percentageTotal > PCT_HI)) {
      baseWarnings.push("PCT_BASE_NOT_100");
      // Base ambigua: las cantidades de la hoja deben ser proporcionales a los valores (misma constante en todas las filas).
      const ratios = rows
        .map((r, i) => (r.rawQty != null && finalPct[i] != null && finalPct[i]! > 0 ? r.rawQty / (finalPct[i] as number) : null))
        .filter((n): n is number => n != null);
      if (ratios.length >= 2) {
        const min = Math.min(...ratios);
        const max = Math.max(...ratios);
        if (min <= 0 || (max - min) / max > 0.01) reviewReasons.push("QUANTITY_PCT_MISMATCH");
      }
    }
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
    baseWarnings,
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

/** Motivo por el que una hoja no aportó una fórmula (para explicarlo al usuario en vez de mostrar una tabla vacía). */
export type SheetDiagnostic = { sheet: string; ok: boolean; reason: string };

const REVIEW_TEXT: Record<string, string> = {
  QUANTITY_NEGATIVE: "hay cantidades negativas",
  QUANTITY_NON_NUMERIC: "las cantidades no son números",
  QUANTITY_SUM_ZERO: "las cantidades suman 0",
  QUANTITY_INCOMPLETE: "faltan cantidades en algunas materias primas",
  NO_NUMERIC_COLUMN: "no hay porcentajes ni cantidades numéricas",
  PCT_ROW_MISSING: "hay materias primas sin porcentaje",
  QUANTITY_PCT_MISMATCH: "las cantidades de la hoja no son proporcionales a los porcentajes (base de cálculo ambigua)",
};
export const reviewReasonText = (codes: string[]): string => codes.map((c) => REVIEW_TEXT[c] ?? c).join("; ");

// ───── Valores calculados: celdas con fórmula de Excel pero sin resultado guardado (archivo generado por script/otra herramienta) ─────
type XCell = { t?: string; v?: unknown; f?: string };

function colToNum(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Evalúa fórmulas aritméticas simples (+ − × ÷, paréntesis, referencias, SUM, %). Cualquier otra cosa → null (no se inventa). */
function evalFormula(sheet: Record<string, unknown>, expr: string, memo: Map<string, number | null>, depth: number): number | null {
  if (depth > 12 || expr.includes("!") || /[A-Za-z]{2,}\(/.test(expr.replace(/SUM\(/gi, ""))) return null;
  const tokens = expr.replace(/\s+/g, "").match(/SUM|\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?|\d+\.?\d*|\.\d+|[()+\-*/,%]/gi);
  if (!tokens || tokens.join("") !== expr.replace(/\s+/g, "")) return null;
  let i = 0;
  const addrNum = (ref: string): number | null => cellNum(sheet, ref.replace(/\$/g, "").toUpperCase(), memo, depth + 1);
  const rangeVals = (ref: string): number[] | null => {
    const [a, b] = ref.replace(/\$/g, "").toUpperCase().split(":");
    const ma = /^([A-Z]+)(\d+)$/.exec(a!);
    const mb = /^([A-Z]+)(\d+)$/.exec(b!);
    if (!ma || !mb) return null;
    const out: number[] = [];
    for (let c = colToNum(ma[1]!); c <= colToNum(mb[1]!); c++) {
      for (let r = Number(ma[2]); r <= Number(mb[2]); r++) {
        const addr = `${XLSX.utils.encode_col(c)}${r}`;
        const v = cellNum(sheet, addr, memo, depth + 1);
        if (v == null && (sheet[addr] as XCell | undefined)?.f) return null;
        if (v != null) out.push(v);
      }
    }
    return out;
  };
  const primary = (): number | null => {
    const t = tokens[i++];
    if (t == null) return null;
    if (t === "(") { const v = sum(); if (tokens[i++] !== ")") return null; return v; }
    if (t === "-") { const v = primary(); return v == null ? null : -v; }
    if (t === "+") return primary();
    if (/^SUM$/i.test(t)) {
      if (tokens[i++] !== "(") return null;
      let total = 0;
      while (tokens[i] !== ")") {
        const a = tokens[i++];
        if (a == null) return null;
        if (a === ",") continue;
        if (a.includes(":")) { const vals = rangeVals(a); if (!vals) return null; total += vals.reduce((x, y) => x + y, 0); }
        else if (/^\$?[A-Za-z]{1,3}\$?\d+$/.test(a)) { const v = addrNum(a); if (v == null) return null; total += v; }
        else if (/^[\d.]+$/.test(a)) total += Number(a);
        else return null;
      }
      i++;
      return total;
    }
    if (/^\$?[A-Za-z]{1,3}\$?\d+$/.test(t)) return addrNum(t);
    if (/^[\d.]+$/.test(t)) { const n = Number(t); return tokens[i] === "%" ? (i++, n / 100) : n; }
    return null;
  };
  const prod = (): number | null => {
    let v = primary();
    while (v != null && (tokens[i] === "*" || tokens[i] === "/")) {
      const op = tokens[i++];
      const w = primary();
      if (w == null) return null;
      if (op === "/") { if (w === 0) return null; v = v / w; } else v = v * w;
    }
    return v;
  };
  const sum = (): number | null => {
    let v = prod();
    while (v != null && (tokens[i] === "+" || tokens[i] === "-")) {
      const op = tokens[i++];
      const w = prod();
      if (w == null) return null;
      v = op === "+" ? v + w : v - w;
    }
    return v;
  };
  const out = sum();
  return i === tokens.length && out != null && Number.isFinite(out) ? out : null;
}

function cellNum(sheet: Record<string, unknown>, addr: string, memo: Map<string, number | null>, depth: number): number | null {
  if (memo.has(addr)) return memo.get(addr) ?? null;
  const cell = sheet[addr] as XCell | undefined;
  let out: number | null = null;
  if (!cell) out = 0;
  else if (cell.t === "e") out = null;
  else if (typeof cell.v === "number") out = cell.v;
  else if (typeof cell.v === "string" && cell.v.trim() !== "") out = parseLooseNumber(cell.v);
  else if (cell.f) { memo.set(addr, null); out = evalFormula(sheet, cell.f, memo, depth); }
  else out = 0;
  memo.set(addr, out);
  return out;
}

/** Completa el valor de las celdas con fórmula que no tienen resultado guardado y vacía las que dieron error (#DIV/0!, etc.). */
export function fillCalculatedCells(sheet: Record<string, unknown>): { unresolved: number } {
  const memo = new Map<string, number | null>();
  let unresolved = 0;
  for (const addr of Object.keys(sheet)) {
    if (addr.startsWith("!")) continue;
    const cell = sheet[addr] as XCell;
    if (!cell || typeof cell !== "object") continue;
    if (cell.t === "e") { cell.t = "z"; cell.v = undefined; continue; }
    if (cell.f && (cell.v === undefined || cell.v === null || cell.v === "")) {
      const v = cellNum(sheet, addr, new Map(memo), 0);
      if (v != null) { cell.t = "n"; cell.v = v; memo.set(addr, v); }
      else unresolved++;
    }
  }
  return { unresolved };
}

export function parseWorkbookBuffer(
  buffer: Buffer,
  meta: {
    sourceFile: string;
    sourceModifiedAt: string | null;
    folderClient?: string;
    knownClients?: string[];
    /** Recibe, por hoja, por qué se aceptó o se descartó (para explicarlo al usuario). */
    onDiagnostic?: (d: SheetDiagnostic) => void;
  }
): ParsedFormulaDraft[] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const fileHash = createHash("sha256").update(buffer).digest("hex");
  const drafts: ParsedFormulaDraft[] = [];
  const diag = (sheet: string, ok: boolean, reason: string) => meta.onDiagnostic?.({ sheet, ok, reason });
  if (wb.SheetNames.length === 0) diag("", false, "El archivo no tiene hojas.");

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const { unresolved } = fillCalculatedCells(sheet as unknown as Record<string, unknown>);
    const merges = ((sheet as unknown as { "!merges"?: Merge[] })["!merges"] ?? []) as Merge[];
    const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
      header: 1,
      defval: "",
      raw: true,
    }) as unknown[][];
    const matrix = aoa.map((row) =>
      (Array.isArray(row) ? row : []).map((c) => cellStr(c))
    );
    // Las celdas combinadas solo guardan el valor en su esquina: se replica dentro del rango de filas del texto (nombre/valor).
    for (const m of merges) {
      const top = matrix[m.s.r]?.[m.s.c];
      if (!top) continue;
      // Un valor numérico combinado en vertical NO se replica (sería inventar el mismo % en cada fila); el texto sí (fase/nombre).
      const numeric = parseLooseNumber(top) != null;
      for (let c = m.s.c; c <= m.e.c; c++) {
        for (let r = m.s.r; r <= m.e.r; r++) {
          if (numeric && r !== m.s.r) continue;
          if (matrix[r] && !matrix[r]![c]) matrix[r]![c] = top;
        }
      }
    }

    const located = locateTable(matrix, merges);
    if (!located.loc) {
      diag(sheetName, false, located.why);
      continue;
    }
    const { rows, skipped, hasQtyCol } = extractRawRows(matrix, located.loc, merges);
    const procedureSteps = extractProcedure(matrix);
    // Una fórmula requiere ingredientes; hojas sin materia prima (p.ej. solo
    // procedimiento) no representan una fórmula importable.
    if (rows.length === 0) {
      diag(sheetName, false, "La tabla de materias primas está vacía (no hay filas con materia prima debajo del encabezado).");
      continue;
    }
    if (unresolved > 0 && rows.every((r) => r.rawPct == null && r.rawQty == null)) {
      diag(sheetName, false, "Los porcentajes son fórmulas de Excel sin resultado guardado: abrí el archivo en Excel o Google Sheets y guardalo para que se calculen.");
      continue;
    }
    diag(sheetName, true, `${rows.length} materias primas.`);
    const idxQty = hasQtyCol ? 1 : -1;

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
    if (skipped.length) warnings.push(`Filas omitidas por no ser materias primas (títulos, subtotales o notas): ${skipped.slice(0, 6).join(" · ")}`);

    if (classified.baseWarnings.includes("PCT_BASE_NOT_100")) {
      warnings.push(
        `Los valores suman ${classified.percentageTotal} (no 100): la fórmula puede estar expresada en otra base (kg cada 100 L, % v/v, densidad). Se conservan exactos; verificar base y cantidades.`
      );
    }
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
