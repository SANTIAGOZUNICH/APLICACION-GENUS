/**
 * Genera remito XLSX desde la plantilla binaria REMITO_MODELO_APP.xlsx.
 * No reconstruye el layout: rellena celdas y, si hace falta, inserta bloques
 * copiando estilos del primer producto antes de la fila TOTAL BULTOS.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import type { RemitoCajaCombo, RemitoLine, RemitoRecord } from "./types";
import { consolidateLinesByProductLoteVto } from "./grouping";
import {
  formatLoteVtoCell,
  lineCajaCombos,
  lineTotalCajas,
  lineTotalUnitsFromCajas,
} from "./line-qty";

/** Filas de datos de producto en el modelo (bloque cada 4 filas). */
export const PRODUCT_BLOCK_ROWS = [23, 27, 31, 35, 39, 43] as const;
const BLOCK_STRIDE = 4;
const DEFAULT_TOTALS_ROW = 47;
const TEMPLATE_SHEET = "THELMA Y LOUISE";
const TEMPLATE_FILE = "REMITO_MODELO_APP.xlsx";

export type FillLine = {
  product: string;
  lote: string;
  vto: string;
  totalUnits: number;
  cajas1: number;
  unidades1: number;
  cajas2: number;
  unidades2: number;
  cajas3: number;
  unidades3: number;
  extraCajas: RemitoCajaCombo[];
};

function resolveTemplatePath(): string {
  const candidates = [
    path.join(process.cwd(), "assets", "remitos", TEMPLATE_FILE),
    path.join(process.cwd(), "frontend", "assets", "remitos", TEMPLATE_FILE),
    path.join(process.cwd(), "assets", "remitos", "REMITO_MODELO.xlsx"),
    path.join(process.cwd(), "frontend", "assets", "remitos", "REMITO_MODELO.xlsx"),
  ];
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(
      path.join(here, "..", "..", "..", "assets", "remitos", TEMPLATE_FILE),
      path.join(here, "..", "..", "..", "assets", "remitos", "REMITO_MODELO.xlsx")
    );
  } catch {
    /* bundler */
  }
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    `No se encontró assets/remitos/${TEMPLATE_FILE} (cwd=${process.cwd()})`
  );
}

function toFillLine(
  line: Pick<
    RemitoLine,
    | "product"
    | "lote"
    | "vto"
    | "totalUnits"
    | "cajas1"
    | "unidades1"
    | "cajas2"
    | "unidades2"
    | "cajas3"
    | "unidades3"
    | "extraCajas"
  >
): FillLine {
  const cajas3 = line.cajas3 ?? 0;
  const unidades3 = line.unidades3 ?? 0;
  const extraCajas = line.extraCajas ?? [];
  const computed = lineTotalUnitsFromCajas({
    cajas1: line.cajas1,
    unidades1: line.unidades1,
    cajas2: line.cajas2,
    unidades2: line.unidades2,
    cajas3,
    unidades3,
    extraCajas,
  });
  return {
    product: line.product,
    lote: line.lote,
    vto: line.vto,
    totalUnits: computed > 0 ? computed : line.totalUnits,
    cajas1: line.cajas1,
    unidades1: line.unidades1,
    cajas2: line.cajas2,
    unidades2: line.unidades2,
    cajas3,
    unidades3,
    extraCajas,
  };
}

function productFormula(row: number, extraUnits = 0): string {
  const base = `D${row}*F${row}+H${row}*J${row}+L${row}*N${row}`;
  return extraUnits > 0 ? `${base}+${extraUnits}` : base;
}

function extrasUnits(extras: RemitoCajaCombo[]): number {
  return extras.reduce((s, e) => s + (e.cajas || 0) * (e.unidades || 0), 0);
}

function extrasCajas(extras: RemitoCajaCombo[]): number {
  return extras.reduce((s, e) => s + (e.cajas || 0), 0);
}

function clearProductBlock(sheet: ExcelJS.Worksheet, dataRow: number) {
  for (const col of ["A", "C", "D", "E", "F", "H", "I", "J", "L", "M", "N"]) {
    sheet.getCell(`${col}${dataRow}`).value = null;
  }
  sheet.getCell(`C${dataRow + 1}`).value = null;
}

function writeX(sheet: ExcelJS.Worksheet, addr: string, hasPair: boolean) {
  sheet.getCell(addr).value = hasPair ? "X" : null;
}

function writeProductBlock(sheet: ExcelJS.Worksheet, dataRow: number, line: FillLine) {
  const combos = lineCajaCombos(line);
  const c1 = combos[0] ?? { cajas: 0, unidades: 0 };
  const c2 = combos[1] ?? { cajas: 0, unidades: 0 };
  const c3 = combos[2] ?? { cajas: 0, unidades: 0 };
  const extras = combos.slice(3);
  const extraU = extrasUnits(extras);
  const total = line.totalUnits;

  // Fórmula auditable + result cacheado (Excel/LibreOffice muestran valor sin recalcular).
  sheet.getCell(`A${dataRow}`).value = {
    formula: productFormula(dataRow, extraU),
    result: total,
  };

  sheet.getCell(`C${dataRow}`).value = line.product;

  sheet.getCell(`D${dataRow}`).value = c1.cajas || null;
  writeX(sheet, `E${dataRow}`, Boolean(c1.cajas || c1.unidades));
  sheet.getCell(`F${dataRow}`).value = c1.unidades || null;

  sheet.getCell(`H${dataRow}`).value = c2.cajas || null;
  writeX(sheet, `I${dataRow}`, Boolean(c2.cajas || c2.unidades));
  sheet.getCell(`J${dataRow}`).value = c2.unidades || null;

  sheet.getCell(`L${dataRow}`).value = c3.cajas || null;
  writeX(sheet, `M${dataRow}`, Boolean(c3.cajas || c3.unidades));
  sheet.getCell(`N${dataRow}`).value = c3.unidades || null;

  let loteVto = formatLoteVtoCell(line.lote, line.vto);
  if (extras.length > 0) {
    const extraTxt = extras
      .map((e) => `${e.cajas}×${e.unidades}`)
      .join(" + ");
    loteVto = `${loteVto}   | EXTRA: ${extraTxt}`;
  }
  sheet.getCell(`C${dataRow + 1}`).value = loteVto;
}

/** Copia estilo de celda (fuente/borde/alineación/relleno) sin mutar el origen. */
function copyCellStyle(from: ExcelJS.Cell, to: ExcelJS.Cell) {
  to.style = JSON.parse(JSON.stringify(from.style ?? {}));
  to.numFmt = from.numFmt;
}

function copyRowStyle(sheet: ExcelJS.Worksheet, fromRow: number, toRow: number) {
  const src = sheet.getRow(fromRow);
  const dst = sheet.getRow(toRow);
  dst.height = src.height;
  for (let c = 1; c <= 14; c++) {
    copyCellStyle(src.getCell(c), dst.getCell(c));
  }
}

/**
 * Inserta bloques de producto (4 filas c/u) antes de la fila de totales,
 * copiando estilos del primer bloque (23–26).
 */
function ensureProductBlocks(
  sheet: ExcelJS.Worksheet,
  needed: number
): { dataRows: number[]; totalsRow: number } {
  const dataRows: number[] = [...PRODUCT_BLOCK_ROWS];
  let totalsRow = DEFAULT_TOTALS_ROW;

  while (dataRows.length < needed) {
    const insertAt = totalsRow;
    // Insertar 4 filas vacías antes de totales
    sheet.spliceRows(insertAt, 0, [], [], [], []);
    const newDataRow = insertAt;
    copyRowStyle(sheet, 23, newDataRow);
    copyRowStyle(sheet, 24, newDataRow + 1);
    copyRowStyle(sheet, 25, newDataRow + 2);
    copyRowStyle(sheet, 26, newDataRow + 3);
    // Semillas de separador X (como en el modelo)
    sheet.getCell(`E${newDataRow}`).value = "X";
    sheet.getCell(`I${newDataRow}`).value = "X";
    sheet.getCell(`M${newDataRow}`).value = "X";
    dataRows.push(newDataRow);
    totalsRow += BLOCK_STRIDE;
  }

  return { dataRows, totalsRow };
}

function writeHeader(sheet: ExcelJS.Worksheet, remito: RemitoRecord) {
  // F4:I4 combinada — fecha de entrega
  const fecha = remito.deliveryDate;
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    const [y, m, d] = fecha.split("-").map(Number);
    sheet.getCell("F4").value = new Date(Date.UTC(y!, m! - 1, d!));
  } else {
    sheet.getCell("F4").value = fecha;
  }
  sheet.getCell("A9").value = remito.clientDisplay;
}

function writeTotals(
  sheet: ExcelJS.Worksheet,
  dataRows: number[],
  filledLines: Array<{ row: number; line: FillLine }>,
  totalsRow: number
) {
  const filledRows = filledLines.map((f) => f.row);
  const unitParts = filledRows.map((r) => `A${r}`);
  const totalUnits = filledLines.reduce((s, f) => s + f.line.totalUnits, 0);
  const totalBultos = filledLines.reduce((s, f) => s + lineTotalCajas(f.line), 0);

  // TOTAL BULTOS: D/H/L de cada producto + literales de cajas extra (no hay columnas extra).
  const cajaParts: string[] = [];
  for (const { row, line } of filledLines) {
    cajaParts.push(`D${row}`, `H${row}`, `L${row}`);
    const extra = extrasCajas(line.extraCajas ?? []);
    if (extra > 0) cajaParts.push(String(extra));
  }

  sheet.getCell(`A${totalsRow}`).value = unitParts.length
    ? { formula: unitParts.join("+"), result: totalUnits }
    : 0;
  sheet.getCell(`C${totalsRow}`).value = "TOTAL BULTOS: ";
  const cajaFormula = cajaParts.length ? cajaParts.join("+") : "0";
  // D47:I47 combinado — escribir fórmula+result en ancla D (única celda visible del merge).
  const dCell = sheet.getCell(`D${totalsRow}`);
  dCell.value = { formula: cajaFormula, result: totalBultos };
  dCell.alignment = { ...(dCell.alignment ?? {}), horizontal: "left", vertical: "middle" };

  // Limpiar bloques de plantilla no usados (muestra THELMA)
  for (const r of dataRows) {
    if (!filledRows.includes(r)) clearProductBlock(sheet, r);
  }
}

function fillTemplateSheet(sheet: ExcelJS.Worksheet, remito: RemitoRecord, lines: FillLine[]) {
  writeHeader(sheet, remito);

  // Limpiar muestra del modelo antes de escribir
  for (const r of PRODUCT_BLOCK_ROWS) clearProductBlock(sheet, r);

  const { dataRows, totalsRow } = ensureProductBlocks(sheet, Math.max(lines.length, 1));
  const filled: Array<{ row: number; line: FillLine }> = [];
  lines.forEach((line, i) => {
    const row = dataRows[i]!;
    writeProductBlock(sheet, row, line);
    filled.push({ row, line });
  });
  writeTotals(sheet, dataRows, filled, totalsRow);
}

/**
 * Genera XLSX a partir de REMITO_MODELO_APP.xlsx (hoja THELMA Y LOUISE).
 * Si hay más productos que bloques, inserta bloques con estilos del modelo
 * y desplaza TOTAL BULTOS.
 */
export async function buildRemitoXlsx(remito: RemitoRecord): Promise<Buffer> {
  const templatePath = resolveTemplatePath();
  const consolidated = consolidateLinesByProductLoteVto(remito.lines).map(toFillLine);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templatePath);
  const sheet =
    wb.getWorksheet(TEMPLATE_SHEET) ??
    wb.worksheets.find((s) => /thelma/i.test(s.name)) ??
    wb.worksheets[0];
  if (!sheet) throw new Error("Plantilla remito sin hojas.");

  // Conservar pageSetup del modelo (A4, portrait, scale 81%, márgenes).
  fillTemplateSheet(sheet, remito, consolidated);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** HTML de vista previa a partir del XLSX generado (mismas celdas que el archivo). */
export async function remitoXlsxToPreviewHtml(bytes: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return "<p>Sin hojas</p>";

  const maxRow = Math.max(sheet.rowCount || DEFAULT_TOTALS_ROW, DEFAULT_TOTALS_ROW);
  const maxCol = 14;

  type MergeBox = { r1: number; c1: number; r2: number; c2: number };
  const merges: MergeBox[] = [];
  for (const m of sheet.model.merges ?? []) {
    const [a, b] = String(m).split(":");
    if (!a || !b) continue;
    const tl = sheet.getCell(a);
    const br = sheet.getCell(b);
    merges.push({
      r1: Number(tl.row),
      c1: Number(tl.col),
      r2: Number(br.row),
      c2: Number(br.col),
    });
  }

  function mergeAt(r: number, c: number): MergeBox | null {
    return merges.find((m) => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2) ?? null;
  }

  function cellText(cell: ExcelJS.Cell): string {
    const v = cell.value;
    if (v == null) return "";
    if (typeof v === "object" && "formula" in v) {
      const f = v as ExcelJS.CellFormulaValue;
      if (f.result != null) return String(f.result);
      // Evaluar fórmulas simples de producto/totales para preview
      return evaluateSimpleFormula(sheet, f.formula) ?? `=${f.formula}`;
    }
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === "object" && "richText" in v) {
      return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("");
    }
    return String(v);
  }

  const rows: string[] = [];
  for (let r = 1; r <= maxRow; r++) {
    const cells: string[] = [];
    for (let c = 1; c <= maxCol; c++) {
      const box = mergeAt(r, c);
      if (box && (r !== box.r1 || c !== box.c1)) continue;
      const cell = sheet.getCell(r, c);
      const text = cellText(cell);
      const colspan = box ? box.c2 - box.c1 + 1 : 1;
      const rowspan = box ? box.r2 - box.r1 + 1 : 1;
      const span =
        (colspan > 1 ? ` colspan="${colspan}"` : "") +
        (rowspan > 1 ? ` rowspan="${rowspan}"` : "");
      cells.push(
        `<td${span} style="border:1px solid #cbd5e1;padding:2px 4px;font-size:11px;white-space:pre-wrap;">${escapeHtml(text)}</td>`
      );
    }
    rows.push(`<tr>${cells.join("")}</tr>`);
  }
  return `<div data-testid="remito-xlsx-preview" style="overflow:auto;max-height:60vh;background:#fff;">
<table style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;min-width:720px;">${rows.join("")}</table>
</div>`;
}

/** Evalúa fórmulas aritméticas simples (productos/sumas de celdas) para la preview. */
function evaluateSimpleFormula(
  sheet: ExcelJS.Worksheet,
  formula: string
): string | null {
  const expr = formula.replace(/\$/g, "").trim();
  if (!/^[\dA-Z+*.\s]+$/i.test(expr)) return null;
  const withValues = expr.replace(/([A-Z]+)(\d+)/gi, (_m, col: string, row: string) => {
    const v = sheet.getCell(`${col.toUpperCase()}${row}`).value;
    if (v == null) return "0";
    if (typeof v === "number") return String(v);
    if (typeof v === "object" && v && "formula" in v) {
      const nested = evaluateSimpleFormula(sheet, (v as ExcelJS.CellFormulaValue).formula);
      return nested ?? "0";
    }
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : "0";
  });
  if (!/^[\d+*.\s]+$/.test(withValues)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const n = Function(`"use strict"; return (${withValues});`)() as number;
    return Number.isFinite(n) ? String(n) : null;
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function lineTotalCajasForRemito(lines: FillLine[]): number {
  return lines.reduce((s, l) => s + lineTotalCajas(l), 0);
}

export const REMITO_XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
