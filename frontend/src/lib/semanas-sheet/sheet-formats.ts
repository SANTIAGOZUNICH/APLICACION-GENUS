/**
 * Formato visual de la Sheet (solo lectura) → `SheetFormats`. PURO: convierte la respuesta de
 * la API de Google (spreadsheets.get con gridData) o los estilos de la copia local .xlsx.
 * Solo se conservan celdas con fondo/negrita/color no triviales y hasta la columna `maxCol`.
 */
import { a1Of, type SheetCellFormat, type SheetFormats } from "./calendar-model";

interface GColor { red?: number | null; green?: number | null; blue?: number | null }
export interface GoogleGridData {
  columnMetadata?: Array<{ pixelSize?: number | null; hiddenByUser?: boolean | null }>;
  rowMetadata?: Array<{ pixelSize?: number | null; hiddenByUser?: boolean | null }>;
  rowData?: Array<{
    values?: Array<{
      effectiveFormat?: { backgroundColor?: GColor | null; textFormat?: { bold?: boolean | null; foregroundColor?: GColor | null } | null } | null;
    }> | null;
  }>;
}

const hex2 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
export function colorToHex(c: GColor | null | undefined): string | null {
  if (!c) return null;
  return `#${hex2(c.red ?? 0)}${hex2(c.green ?? 0)}${hex2(c.blue ?? 0)}`.toUpperCase();
}
const isWhite = (h: string | null) => !h || h === "#FFFFFF";
const isBlack = (h: string | null) => !h || h === "#000000";
const NORMAL_ROW = 21;

export const FORMAT_MAX_COL = 12;

export function formatsFromGoogleGrid(data: GoogleGridData | undefined, maxCol = FORMAT_MAX_COL): SheetFormats {
  const out: SheetFormats = { colWidths: [], hiddenRows: [], rowHeights: {}, cells: {} };
  (data?.columnMetadata ?? []).forEach((c, i) => {
    out.colWidths[i] = c.hiddenByUser ? 0 : (c.pixelSize ?? 0);
  });
  (data?.rowMetadata ?? []).forEach((r, i) => {
    if (r.hiddenByUser) out.hiddenRows.push(i + 1);
    else if (r.pixelSize && Math.abs(r.pixelSize - NORMAL_ROW) > 2) out.rowHeights![i + 1] = r.pixelSize;
  });
  (data?.rowData ?? []).forEach((row, r) => {
    (row.values ?? []).slice(0, maxCol).forEach((cell, c) => {
      const f = cell?.effectiveFormat;
      if (!f) return;
      const bg = colorToHex(f.backgroundColor);
      const fg = colorToHex(f.textFormat?.foregroundColor);
      const fmt: SheetCellFormat = {};
      if (!isWhite(bg)) fmt.bg = bg!;
      if (!isBlack(fg)) fmt.fg = fg!;
      if (f.textFormat?.bold) fmt.bold = true;
      if (Object.keys(fmt).length) out.cells[a1Of(r + 1, c)] = fmt;
    });
  });
  return out;
}
