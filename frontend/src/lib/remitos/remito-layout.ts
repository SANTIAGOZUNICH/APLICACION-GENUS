import ExcelJS from "exceljs";
import { cellDisplayText, escapeHtml } from "./remito-sheet-text";

/**
 * Maquetación ÚNICA del remito impreso: se calcula desde el XLSX ya completo (la plantilla del laboratorio), de modo que
 * la vista previa, el PDF y el XLSX comparten estructura y datos. Reproduce la planilla impresa en UNA sola hoja A4 vertical,
 * cuadrícula fina gris en todas las celdas y filas con la altura de la plantilla, ajustada a 1 página de ancho por 1 de alto.
 */
export const REMITO_PAGE_W = 595.28; // A4 vertical (210 × 297 mm)
export const REMITO_PAGE_H = 841.89;
const MARGIN_Y = 53.9; // 0,748" del modelo
const MARGIN_X = 51; // 0,7087" del modelo
/** Relación entre el ancho de columna de la plantilla y los puntos impresos (la planilla original impresa). */
const COL_PRINT_FACTOR = 0.95;
const BASE_COLS = 9;
const ALL_COLS = 14;

export type LayoutText = {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  bold: boolean;
  italic: boolean;
  size: number;
  align: "left" | "center" | "right";
  valign: "top" | "middle" | "bottom";
  wrap: boolean;
};
export type LayoutRect = { x: number; y: number; w: number; h: number };
export type LayoutPage = { rects: LayoutRect[]; texts: LayoutText[] };
export type RemitoLayout = { pages: LayoutPage[] };

function alignOf(h: string | undefined, numeric: boolean): "left" | "center" | "right" {
  if (h === "center" || h === "centerContinuous") return "center";
  if (h === "right") return "right";
  if (h === "left") return "left";
  return numeric ? "right" : "left";
}

type Box = { r1: number; c1: number; r2: number; c2: number };

export async function layoutRemitoFromXlsx(bytes: Buffer): Promise<RemitoLayout> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return { pages: [{ rects: [], texts: [] }] };

  const lastRow = Math.max(sheet.rowCount || 0, 47);
  const merges: Box[] = [];
  for (const m of sheet.model.merges ?? []) {
    const [a, b] = String(m).split(":");
    if (!a || !b) continue;
    const tl = sheet.getCell(a);
    const br = sheet.getCell(b);
    merges.push({ r1: Number(tl.row), c1: Number(tl.col), r2: Number(br.row), c2: Number(br.col) });
  }
  const mergeAt = (r: number, c: number) => merges.find((m) => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2) ?? null;

  // Las columnas J–N solo se imprimen si llevan cajas (2.ª y 3.ª configuración); sin ellas el aspecto es el del original (A–I).
  let ncols = BASE_COLS;
  for (let r = 1; r <= lastRow && ncols === BASE_COLS; r++) {
    for (let c = BASE_COLS + 1; c <= ALL_COLS; c++) {
      if (cellDisplayText(sheet, sheet.getCell(r, c)).trim() !== "") {
        ncols = ALL_COLS;
        break;
      }
    }
  }

  const rawPts: number[] = [];
  for (let c = 1; c <= ncols; c++) {
    const w = sheet.getColumn(c).width ?? 9.140625;
    rawPts.push(Math.trunc(w * 7 + 5) * 0.75);
  }
  // Geometría natural de la plantilla (columnas y alturas de fila tal cual); luego se ajusta TODA a una sola hoja A4 vertical
  // (equivale a «ajustar a 1 página de ancho por 1 de alto»).
  const widths = rawPts.map((n) => n * COL_PRINT_FACTOR);
  const naturalW = widths.reduce((s, n) => s + n, 0);
  const colX = widths.map((_, i) => widths.slice(0, i).reduce((s, n) => s + n, 0));
  const heights: number[] = [];
  for (let r = 1; r <= lastRow; r++) heights.push(sheet.getRow(r).height ?? 15);
  const naturalH = heights.reduce((s, n) => s + n, 0);
  const k = Math.min((REMITO_PAGE_W - 2 * MARGIN_X) / naturalW, (REMITO_PAGE_H - 2 * MARGIN_Y) / naturalH);
  const x0 = (REMITO_PAGE_W - naturalW * k) / 2;

  const page: LayoutPage = { rects: [], texts: [] };
  let y = MARGIN_Y;
  for (let r = 1; r <= lastRow; r++) {
    const h = heights[r - 1]! * k;
    for (let c = 1; c <= ncols; c++) {
      const box = mergeAt(r, c);
      if (box && (r !== box.r1 || c !== box.c1)) continue;
      const c2 = box ? Math.min(box.c2, ncols) : c;
      const w = (colX[c2 - 1]! + widths[c2 - 1]! - colX[c - 1]!) * k;
      const x = x0 + colX[c - 1]! * k;
      page.rects.push({ x, y, w, h });
      const cell = sheet.getCell(r, c);
      const text = cellDisplayText(sheet, cell).trim();
      if (!text) continue;
      const numeric = typeof cell.value === "number" || (typeof cell.value === "object" && cell.value !== null && "result" in cell.value && typeof cell.value.result === "number");
      page.texts.push({
        x,
        y,
        w,
        h,
        text,
        bold: Boolean(cell.font?.bold),
        italic: Boolean(cell.font?.italic),
        size: (cell.font?.size ?? 11) * 0.95 * k,
        align: alignOf(cell.alignment?.horizontal as string | undefined, numeric),
        valign: (cell.alignment?.vertical as "top" | "middle" | "bottom" | undefined) ?? "bottom",
        wrap: Boolean(cell.alignment?.wrapText),
      });
    }
    y += h;
  }
  return { pages: [page] };
}

const GRID = "#8c8c8c";

/** Vista previa: una página SVG por hoja impresa, texto negro sobre blanco con colores propios (no depende del tema de la app). */
export function remitoLayoutToPreviewHtml(layout: RemitoLayout): string {
  const svgs = layout.pages.map((p, i) => {
    const rects = p.rects.map((r) => `<rect x="${r.x.toFixed(2)}" y="${r.y.toFixed(2)}" width="${r.w.toFixed(2)}" height="${r.h.toFixed(2)}" fill="none" stroke="${GRID}" stroke-width="0.6"/>`).join("");
    const texts = p.texts
      .map((t) => {
        const pad = 3;
        const anchor = t.align === "center" ? "middle" : t.align === "right" ? "end" : "start";
        const tx = t.align === "center" ? t.x + t.w / 2 : t.align === "right" ? t.x + t.w - pad : t.x + pad;
        const ty = t.valign === "middle" ? t.y + t.h / 2 + t.size * 0.35 : t.valign === "top" ? t.y + t.size + 1 : t.y + t.h - 3;
        const est = t.text.length * t.size * 0.56;
        const fit = est > t.w - 2 * pad ? ` textLength="${(t.w - 2 * pad).toFixed(1)}" lengthAdjust="spacingAndGlyphs"` : "";
        return `<text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" text-anchor="${anchor}" font-family="Arial, Helvetica, sans-serif" font-size="${t.size.toFixed(2)}" font-weight="${t.bold ? 700 : 400}" font-style="${t.italic ? "italic" : "normal"}" fill="#000000"${fit}>${escapeHtml(t.text)}</text>`;
      })
      .join("");
    return `<figure style="margin:0 0 12px 0;"><svg viewBox="0 0 ${REMITO_PAGE_W} ${REMITO_PAGE_H}" width="100%" style="display:block;max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #9ca3af;box-shadow:0 1px 3px rgba(0,0,0,.25);" role="img" aria-label="Remito, página ${i + 1} de ${layout.pages.length}"><rect width="100%" height="100%" fill="#ffffff"/>${rects}${texts}</svg><figcaption style="text-align:center;font:12px Arial,sans-serif;color:#111827;background:#ffffff;padding:2px 0;">Hoja A4 vertical · 1 página</figcaption></figure>`;
  });
  return `<div data-testid="remito-xlsx-preview" style="background:#ffffff;color:#000000;color-scheme:light;padding:8px;overflow:auto;max-height:75vh;">${svgs.join("")}</div>`;
}
