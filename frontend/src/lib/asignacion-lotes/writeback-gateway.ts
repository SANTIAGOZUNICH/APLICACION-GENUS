import "server-only";

import { google } from "googleapis";
import { createGoogleAuth, SHEETS_WRITE_SCOPES } from "@/lib/adapters/google/google-auth";
import { sheetsReader } from "@/lib/adapters/sheets/sheets-reader";

/**
 * Puerto hacia Google Sheets para el write-back (opción C). Es una interfaz
 * a propósito: los tests usan una Sheet en memoria; la implementación real
 * (abajo) solo se instancia con credenciales + allowlist.
 */
export interface SheetCellGateway {
  /** Valores tal como los ve el usuario (formateados), toda la hoja. */
  readTab(spreadsheetId: string, tab: string): Promise<string[][]>;
  /** Valor formateado de UNA celda (confirmación posterior a escribir). */
  readCell(spreadsheetId: string, tab: string, a1: string): Promise<string>;
  /** Texto de fórmula si la celda es una fórmula (empieza con "="), si no null. */
  readFormula(spreadsheetId: string, tab: string, a1: string): Promise<string | null>;
  /** Escribe UNA celda. Nunca formato, nunca otras celdas. */
  writeCell(spreadsheetId: string, tab: string, a1: string, value: string): Promise<void>;
}

function quoteTab(tab: string): string {
  return `'${tab.replace(/'/g, "''")}'`;
}

export class GoogleSheetCellGateway implements SheetCellGateway {
  private sheets() {
    return google.sheets({ version: "v4", auth: createGoogleAuth(SHEETS_WRITE_SCOPES) });
  }

  readTab(spreadsheetId: string, tab: string): Promise<string[][]> {
    // Lectura con el lector readonly existente (misma que usa el sync).
    return sheetsReader.readTab(spreadsheetId, tab);
  }

  async readCell(spreadsheetId: string, tab: string, a1: string): Promise<string> {
    const res = await this.sheets().spreadsheets.values.get({
      spreadsheetId,
      range: `${quoteTab(tab)}!${a1}`,
      valueRenderOption: "FORMATTED_VALUE",
    });
    return String(res.data.values?.[0]?.[0] ?? "");
  }

  async readFormula(spreadsheetId: string, tab: string, a1: string): Promise<string | null> {
    const res = await this.sheets().spreadsheets.values.get({
      spreadsheetId,
      range: `${quoteTab(tab)}!${a1}`,
      valueRenderOption: "FORMULA",
    });
    const raw = String(res.data.values?.[0]?.[0] ?? "");
    return raw.startsWith("=") ? raw : null;
  }

  async writeCell(spreadsheetId: string, tab: string, a1: string, value: string): Promise<void> {
    await this.sheets().spreadsheets.values.update({
      spreadsheetId,
      range: `${quoteTab(tab)}!${a1}`,
      // USER_ENTERED: una fecha dd/mm/aaaa se guarda como fecha real, igual que si la tipeara una persona.
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[value]] },
    });
  }
}
