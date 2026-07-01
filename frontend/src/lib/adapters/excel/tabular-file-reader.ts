import "server-only";

import type { DocumentRef } from "@/lib/adapters/drive/types/document.types";
import {
  isGoogleSpreadsheetMime,
  readerKindForMime,
  type TabularReaderKind,
} from "@/lib/adapters/excel/excel-mime";
import { excelReader } from "@/lib/adapters/excel/excel-reader";
import { sheetsReader } from "@/lib/adapters/sheets/sheets-reader";

export interface TabularReadResult {
  rows: string[][];
  tabUsed?: string;
  tabsAttempted: string[];
  readerUsed: TabularReaderKind;
  mimeType: string;
  sheetNames?: string[];
  warning?: string;
}

const DEFAULT_TAB_CANDIDATES = ["Hoja 1"];

export async function readTabularFile(
  docRef: DocumentRef,
  tabCandidates: string[] = DEFAULT_TAB_CANDIDATES
): Promise<TabularReadResult> {
  const readerUsed = readerKindForMime(docRef.mimeType);

  if (!readerUsed) {
    return {
      rows: [],
      tabsAttempted: tabCandidates,
      readerUsed: "sheets",
      mimeType: docRef.mimeType,
      warning: `Tipo de archivo no soportado: ${docRef.mimeType}`,
    };
  }

  if (isGoogleSpreadsheetMime(docRef.mimeType)) {
    return readGoogleSpreadsheet(docRef.fileId, docRef.mimeType, tabCandidates);
  }

  return readExcelFile(docRef.fileId, docRef.mimeType, tabCandidates);
}

async function readGoogleSpreadsheet(
  fileId: string,
  mimeType: string,
  tabCandidates: string[]
): Promise<TabularReadResult> {
  for (const tabName of tabCandidates) {
    try {
      const rows = await sheetsReader.readTab(fileId, tabName);
      if (rows.length > 1) {
        return {
          rows,
          tabUsed: tabName,
          tabsAttempted: tabCandidates,
          readerUsed: "sheets",
          mimeType,
        };
      }
    } catch {
      continue;
    }
  }

  try {
    const rows = await sheetsReader.readFirstTab(fileId);
    return {
      rows,
      tabUsed: rows.length > 1 ? "first-tab" : undefined,
      tabsAttempted: [...tabCandidates, "first-tab"],
      readerUsed: "sheets",
      mimeType,
      warning:
        rows.length <= 1
          ? "Google Sheet sin filas de datos en tabs conocidas."
          : undefined,
    };
  } catch (error) {
    return {
      rows: [],
      tabsAttempted: [...tabCandidates, "first-tab"],
      readerUsed: "sheets",
      mimeType,
      warning:
        error instanceof Error
          ? error.message
          : "No se pudo leer el Google Sheet.",
    };
  }
}

async function readExcelFile(
  fileId: string,
  mimeType: string,
  tabCandidates: string[]
): Promise<TabularReadResult> {
  const tabsAttempted = [...tabCandidates];

  try {
    const workbook = await excelReader.readWorkbook(fileId);
    tabsAttempted.push(...workbook.sheetNames);

    for (const tabName of tabCandidates) {
      if (!workbook.sheetNames.includes(tabName)) continue;
      const rows = await excelReader.readSheet(fileId, tabName);
      if (rows.length > 1) {
        return {
          rows,
          tabUsed: tabName,
          tabsAttempted,
          readerUsed: "excel",
          mimeType,
          sheetNames: workbook.sheetNames,
        };
      }
    }

    const first = await excelReader.readFirstSheet(fileId);
    return {
      rows: first.rows,
      tabUsed: first.sheetName,
      tabsAttempted,
      readerUsed: "excel",
      mimeType,
      sheetNames: first.sheetNames,
      warning:
        first.rows.length <= 1
          ? "Excel sin filas de datos en hojas detectadas."
          : undefined,
    };
  } catch (error) {
    return {
      rows: [],
      tabsAttempted,
      readerUsed: "excel",
      mimeType,
      warning:
        error instanceof Error
          ? error.message
          : "No se pudo descargar o parsear el Excel.",
    };
  }
}
