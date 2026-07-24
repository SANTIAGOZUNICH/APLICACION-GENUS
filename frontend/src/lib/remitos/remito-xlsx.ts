import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import type { RemitoLine, RemitoRecord } from "./types";
import { consolidateLinesByProductLoteVto } from "./grouping";

const PRODUCT_START_ROW = 24;
const PRODUCT_END_ROW = 45;
const PRODUCTS_PER_PAGE = PRODUCT_END_ROW - PRODUCT_START_ROW + 1; // 22
const TOTALS_ROW = 47;

function resolveTemplatePath(): string {
  const candidates = [
    path.join(process.cwd(), "assets", "remitos", "REMITO_MODELO.xlsx"),
    path.join(process.cwd(), "frontend", "assets", "remitos", "REMITO_MODELO.xlsx"),
  ];
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(
      path.join(here, "..", "..", "..", "assets", "remitos", "REMITO_MODELO.xlsx")
    );
  } catch {
    /* bundler */
  }
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    "No se encontró assets/remitos/REMITO_MODELO.xlsx (cwd=" + process.cwd() + ")"
  );
}

function formatProductCell(line: Pick<RemitoLine, "product" | "lote" | "vto">): string {
  const lote = line.lote?.trim() || "—";
  const vto = line.vto?.trim() || "—";
  return `${line.product}  L: ${lote}   VTO: ${vto}`;
}

type FillLine = {
  product: string;
  lote: string;
  vto: string;
  totalUnits: number;
  cajas1: number;
  unidades1: number;
  cajas2: number;
  unidades2: number;
};

function writeProductRow(sheet: ExcelJS.Worksheet, row: number, line: FillLine) {
  sheet.getCell(`A${row}`).value = line.totalUnits;
  sheet.getCell(`C${row}`).value = formatProductCell(line);
  sheet.getCell(`D${row}`).value = line.cajas1 || null;
  sheet.getCell(`F${row}`).value = line.unidades1 || null;
  sheet.getCell(`H${row}`).value = line.cajas2 || null;
  sheet.getCell(`J${row}`).value = line.unidades2 || null;
}

function writeHeader(sheet: ExcelJS.Worksheet, remito: RemitoRecord) {
  sheet.getCell("F4").value = remito.deliveryDate;
  sheet.getCell("A9").value = remito.clientDisplay;
}

function writeTotals(sheet: ExcelJS.Worksheet, lines: FillLine[]) {
  const totalUnits = lines.reduce((s, l) => s + l.totalUnits, 0);
  const totalCajas = lines.reduce((s, l) => s + l.cajas1 + l.cajas2, 0);
  sheet.getCell(`A${TOTALS_ROW}`).value = totalUnits;
  sheet.getCell(`C${TOTALS_ROW}`).value = `TOTAL BULTOS: ${totalCajas}`;
  sheet.getCell(`D${TOTALS_ROW}`).value = totalCajas;
}

function fillTemplateSheet(
  sheet: ExcelJS.Worksheet,
  remito: RemitoRecord,
  pageLines: FillLine[]
) {
  writeHeader(sheet, remito);
  for (let i = 0; i < PRODUCTS_PER_PAGE; i++) {
    const row = PRODUCT_START_ROW + i;
    const line = pageLines[i];
    if (line) writeProductRow(sheet, row, line);
    else {
      sheet.getCell(`A${row}`).value = null;
      sheet.getCell(`C${row}`).value = null;
      sheet.getCell(`D${row}`).value = null;
      sheet.getCell(`F${row}`).value = null;
      sheet.getCell(`H${row}`).value = null;
      sheet.getCell(`J${row}`).value = null;
    }
  }
  writeTotals(sheet, pageLines);
}

/** Hoja adicional simplificada (misma data) cuando hay >22 productos. */
function addOverflowSheet(
  wb: ExcelJS.Workbook,
  remito: RemitoRecord,
  pageIdx: number,
  pageLines: FillLine[]
) {
  const sheet = wb.addWorksheet(`Remito ${pageIdx + 1}`);
  sheet.getCell("A1").value = "REMITO (continuación)";
  sheet.getCell("A2").value = `Cliente: ${remito.clientDisplay}`;
  sheet.getCell("A3").value = `Fecha: ${remito.deliveryDate}`;
  sheet.getCell("A5").value = "TOTAL";
  sheet.getCell("B5").value = "PRODUCTO";
  sheet.getCell("C5").value = "CAJAS1";
  sheet.getCell("D5").value = "UNIDADES1";
  sheet.getCell("E5").value = "CAJAS2";
  sheet.getCell("F5").value = "UNIDADES2";
  pageLines.forEach((line, i) => {
    const r = 6 + i;
    sheet.getCell(`A${r}`).value = line.totalUnits;
    sheet.getCell(`B${r}`).value = formatProductCell(line);
    sheet.getCell(`C${r}`).value = line.cajas1;
    sheet.getCell(`D${r}`).value = line.unidades1;
    sheet.getCell(`E${r}`).value = line.cajas2;
    sheet.getCell(`F${r}`).value = line.unidades2;
  });
  const totalUnits = pageLines.reduce((s, l) => s + l.totalUnits, 0);
  const totalCajas = pageLines.reduce((s, l) => s + l.cajas1 + l.cajas2, 0);
  const t = 6 + pageLines.length + 1;
  sheet.getCell(`A${t}`).value = totalUnits;
  sheet.getCell(`B${t}`).value = `TOTAL BULTOS: ${totalCajas}`;
}

/**
 * Genera XLSX a partir del modelo REMITO_MODELO.xlsx.
 * Multi-página si hay más de ~22 productos (hoja 1 = plantilla; extras = tablas).
 */
export async function buildRemitoXlsx(remito: RemitoRecord): Promise<Buffer> {
  const templatePath = resolveTemplatePath();
  const consolidated = consolidateLinesByProductLoteVto(remito.lines) as FillLine[];
  const pages: FillLine[][] = [];
  if (consolidated.length === 0) {
    pages.push([]);
  } else {
    for (let i = 0; i < consolidated.length; i += PRODUCTS_PER_PAGE) {
      pages.push(consolidated.slice(i, i + PRODUCTS_PER_PAGE));
    }
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templatePath);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error("Plantilla remito sin hojas.");
  fillTemplateSheet(sheet, remito, pages[0] ?? []);

  for (let i = 1; i < pages.length; i++) {
    addOverflowSheet(wb, remito, i, pages[i]!);
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export const REMITO_XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
