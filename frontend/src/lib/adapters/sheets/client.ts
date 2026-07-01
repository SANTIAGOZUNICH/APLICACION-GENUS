import "server-only";

import { google } from "googleapis";
import { createGoogleAuth } from "@/lib/adapters/google/google-auth";
import { getLegacySpreadsheetId } from "@/lib/adapters/drive/drive-folder-config";
import { sheetsReader } from "@/lib/adapters/sheets/sheets-reader";

function getTabName(envKey: string, fallback: string): string {
  return process.env[envKey]?.trim() || fallback;
}

export function getSheetsTabNames() {
  return {
    lotes: getTabName("SHEETS_TAB_LOTES", "LOTES"),
    saldos: getTabName("SHEETS_TAB_SALDOS", "SALDOS"),
    movimientos: getTabName("SHEETS_TAB_MOVIMIENTOS", "MOVIMIENTOS"),
  };
}

/**
 * @deprecated E7 legacy single-spreadsheet reader.
 * E7.1+ uses SheetsReader + OperationsDocumentRepository.
 */
export async function readLegacySheetTab(tabName: string): Promise<string[][]> {
  const spreadsheetId = getLegacySpreadsheetId();
  if (!spreadsheetId) {
    throw new Error(
      "GOOGLE_SHEETS_SPREADSHEET_ID está deprecated. Usá la config Drive de E7.1."
    );
  }
  return sheetsReader.readTab(spreadsheetId, tabName);
}

/** @deprecated */
export async function readOperationsTabs() {
  const tabs = getSheetsTabNames();
  const spreadsheetId = getLegacySpreadsheetId();
  if (!spreadsheetId) {
    throw new Error("Legacy spreadsheet no configurado.");
  }

  const auth = createGoogleAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const [lotesRows, saldosRows, movimientosRows] = await Promise.all([
    sheetsReader.readTab(spreadsheetId, tabs.lotes),
    sheetsReader.readTab(spreadsheetId, tabs.saldos),
    sheetsReader.readTab(spreadsheetId, tabs.movimientos),
  ]);

  void sheets;
  return { tabs, lotesRows, saldosRows, movimientosRows };
}

export { sheetsReader };
