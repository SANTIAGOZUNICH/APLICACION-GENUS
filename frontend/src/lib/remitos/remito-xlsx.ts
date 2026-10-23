/**
 * Genera remito XLSX desde la plantilla binaria REMITO_MODELO_APP.xlsx.
 * No reconstruye el layout: rellena celdas y, si hace falta, inserta bloques
 * copiando estilos del primer producto antes de la fila TOTAL BULTOS.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { layoutRemitoFromXlsx, remitoLayoutToPreviewHtml } from "./remito-layout";
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

export function toFillLine(
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

const COMBO_COLS = [
  ["D", "E", "F"],
  ["H", "I", "J"],
  ["L", "M", "N"],
] as const;

/** Filas del bloque de producto que llevan cajas: la principal y, debajo, las dos filas libres del bloque (3 configuraciones por fila). */
function comboRowsOf(dataRow: number): number[] {
  return [dataRow, dataRow + 2, dataRow + 3];
}

function rowFormula(row: number): string {
  return `D${row}*F${row}+H${row}*J${row}+L${row}*N${row}`;
}

function extrasUnits(extras: RemitoCajaCombo[]): number {
  return extras.reduce((s, e) => s + (e.cajas || 0) * (e.unidades || 0), 0);
}

function extrasCajas(extras: RemitoCajaCombo[]): number {
  return extras.reduce((s, e) => s + (e.cajas || 0), 0);
}

function clearProductBlock(sheet: ExcelJS.Worksheet, dataRow: number) {
  for (const col of ["A", "C"]) sheet.getCell(`${col}${dataRow}`).value = null;
  for (const r of comboRowsOf(dataRow)) {
    for (const cols of COMBO_COLS) for (const col of cols) sheet.getCell(`${col}${r}`).value = null;
  }
  sheet.getCell(`C${dataRow + 1}`).value = null;
  sheet.getCell(`C${dataRow + 3}`).value = null;
}

function writeX(sheet: ExcelJS.Worksheet, addr: string, hasPair: boolean) {
  sheet.getCell(addr).value = hasPair ? "X" : null;
}

/**
 * Escribe el producto y TODAS sus configuraciones de caja en las columnas de distribución del modelo: tres por fila
 * (cajas · X · unidades), la primera en la fila del producto y las siguientes en las filas libres de debajo, con el mismo
 * estilo. La fila de lote/vencimiento lleva solo esos datos. Devuelve las filas que usan cajas (para fórmulas y totales).
 */
function writeProductBlock(sheet: ExcelJS.Worksheet, dataRow: number, line: FillLine): { rows: number[]; overflow: RemitoCajaCombo[] } {
  const combos = lineCajaCombos(line).filter((c) => (c.cajas || 0) > 0 || (c.unidades || 0) > 0);
  const slots = comboRowsOf(dataRow).length * 3;
  const placed = combos.slice(0, slots);
  // Más de 9 configuraciones (no entran en el bloque): se anotan como texto en la última fila libre, nunca se pierden.
  const overflow = combos.slice(slots);
  const rows = comboRowsOf(dataRow).filter((_, i) => i === 0 || placed.length > i * 3);
  const total = line.totalUnits;

  sheet.getCell(`C${dataRow}`).value = line.product;
  // Mismo estilo (fuente, tamaño, alineación) para TODAS las cantidades de caja: el de la 1.ª configuración (D · E · F).
  const styleSrc = COMBO_COLS[0].map((col) => sheet.getCell(`${col}${dataRow}`).style);
  const proto = JSON.parse(JSON.stringify(styleSrc)) as ExcelJS.Style[];
  rows.forEach((r, i) => {
    for (const cols of COMBO_COLS) cols.forEach((col, k) => (sheet.getCell(`${col}${r}`).style = JSON.parse(JSON.stringify(proto[k] ?? {}))));
    COMBO_COLS.forEach((cols, j) => {
      const c = placed[i * 3 + j] ?? { cajas: 0, unidades: 0 };
      sheet.getCell(`${cols[0]}${r}`).value = c.cajas || null;
      writeX(sheet, `${cols[1]}${r}`, Boolean(c.cajas || c.unidades));
      sheet.getCell(`${cols[2]}${r}`).value = c.unidades || null;
    });
  });

  // Fórmula auditable + result cacheado (Excel/LibreOffice muestran valor sin recalcular).
  const extraU = extrasUnits(overflow);
  sheet.getCell(`A${dataRow}`).value = {
    formula: rows.map(rowFormula).join("+") + (extraU > 0 ? `+${extraU}` : ""),
    result: total,
  };
  sheet.getCell(`C${dataRow + 1}`).value = formatLoteVtoCell(line.lote, line.vto);
  if (overflow.length > 0) sheet.getCell(`C${dataRow + 3}`).value = `+ ${overflow.map((e) => `${e.cajas}×${e.unidades}`).join(" + ")}`;
  return { rows, overflow };
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
    // Formato explícito: Excel mostraba la fecha según la región del equipo (mm-dd-yy); acá siempre DD/MM/AAAA.
    sheet.getCell("F4").numFmt = "dd/mm/yyyy";
  } else {
    sheet.getCell("F4").value = fecha;
  }
  sheet.getCell("A9").value = remito.clientDisplay;
}

function writeTotals(
  sheet: ExcelJS.Worksheet,
  dataRows: number[],
  filledLines: Array<{ row: number; line: FillLine; rows: number[]; overflow: RemitoCajaCombo[] }>,
  totalsRow: number
) {
  const filledRows = filledLines.map((f) => f.row);
  const unitParts = filledRows.map((r) => `A${r}`);
  const totalUnits = filledLines.reduce((s, f) => s + f.line.totalUnits, 0);
  const totalBultos = filledLines.reduce((s, f) => s + lineTotalCajas(f.line), 0);

  // TOTAL BULTOS: columnas de cajas (D/H/L) de todas las filas con cajas de cada producto.
  const cajaParts: string[] = [];
  for (const { rows, overflow } of filledLines) {
    for (const r of rows) cajaParts.push(`D${r}`, `H${r}`, `L${r}`);
    const extra = extrasCajas(overflow);
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
  dCell.alignment = { ...(dCell.alignment ?? {}), horizontal: "center", vertical: "middle" };

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
  const filled: Array<{ row: number; line: FillLine; rows: number[]; overflow: RemitoCajaCombo[] }> = [];
  lines.forEach((line, i) => {
    const row = dataRows[i]!;
    const w = writeProductBlock(sheet, row, line);
    filled.push({ row, line, ...w });
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

  fillTemplateSheet(sheet, remito, consolidated);
  // Impresión: UNA sola hoja A4 vertical (ajustada a 1 página de ancho por 1 de alto), SIN cuadrícula impresa ni en pantalla, márgenes del modelo.
  sheet.pageSetup = { ...sheet.pageSetup, paperSize: 9, orientation: "portrait", showGridLines: false, horizontalCentered: true, fitToPage: true, fitToWidth: 1, fitToHeight: 1, scale: undefined };
  sheet.views = sheet.views.map((v) => ({ ...v, showGridLines: false }));
  // La plantilla no define bordes de celda: sin cuadrícula no queda ninguna línea.
  // Área de impresión: A–I como la planilla original; hasta N solo si hay 2.ª/3.ª configuración de cajas (columnas J–N).
  let lastCol = "I";
  for (let r = 1; r <= sheet.rowCount && lastCol === "I"; r++) for (let c = 10; c <= 14; c++) if (sheet.getCell(r, c).value != null && sheet.getCell(r, c).value !== "") lastCol = "N";
  sheet.pageSetup.printArea = `A1:${lastCol}${sheet.rowCount}`;

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** HTML de vista previa: las MISMAS páginas que el PDF (ver remito-layout.ts), derivadas de este XLSX. */
export async function remitoXlsxToPreviewHtml(bytes: Buffer): Promise<string> {
  return remitoLayoutToPreviewHtml(await layoutRemitoFromXlsx(bytes));
}

export function lineTotalCajasForRemito(lines: FillLine[]): number {
  return lines.reduce((s, l) => s + lineTotalCajas(l), 0);
}

export const REMITO_XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
