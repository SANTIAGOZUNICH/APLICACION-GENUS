import "server-only";

import { SPREADSHEET_MIME } from "@/lib/adapters/sheets/sheets-reader";

export const EXCEL_XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const EXCEL_XLS_MIME = "application/vnd.ms-excel";

export const TABULAR_FILE_MIMES = [
  SPREADSHEET_MIME,
  EXCEL_XLSX_MIME,
  EXCEL_XLS_MIME,
] as const;

export type TabularReaderKind = "sheets" | "excel";

export function isGoogleSpreadsheetMime(mimeType: string): boolean {
  return mimeType === SPREADSHEET_MIME;
}

export function isExcelMime(mimeType: string): boolean {
  return mimeType === EXCEL_XLSX_MIME || mimeType === EXCEL_XLS_MIME;
}

export function isTabularFileMime(mimeType: string): boolean {
  return (
    isGoogleSpreadsheetMime(mimeType) ||
    isExcelMime(mimeType)
  );
}

export function readerKindForMime(mimeType: string): TabularReaderKind | null {
  if (isGoogleSpreadsheetMime(mimeType)) return "sheets";
  if (isExcelMime(mimeType)) return "excel";
  return null;
}

export function buildTabularMimeQuery(): string {
  return TABULAR_FILE_MIMES.map((mime) => `mimeType='${mime}'`).join(" or ");
}
