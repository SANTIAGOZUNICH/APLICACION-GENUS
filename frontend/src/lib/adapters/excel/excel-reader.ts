import "server-only";

import * as XLSX from "xlsx";
import { google } from "googleapis";
import { createGoogleAuth } from "@/lib/adapters/google/google-auth";
import { serverCache } from "@/lib/adapters/drive/cache/server-cache";

export interface ExcelWorkbookMeta {
  sheetNames: string[];
}

/** Server-side Excel reader — downloads via Drive API, never exposes file to client. */
export class ExcelReader {
  async readWorkbook(fileId: string): Promise<ExcelWorkbookMeta> {
    const workbook = await this.loadWorkbook(fileId);
    return { sheetNames: workbook.SheetNames };
  }

  async readSheet(fileId: string, sheetName?: string): Promise<string[][]> {
    const cacheKey = `excel:${fileId}:sheet:${sheetName ?? "first"}`;
    const cached = serverCache.get<string[][]>(cacheKey);
    if (cached) return cached;

    const workbook = await this.loadWorkbook(fileId);
    const rows = this.workbookToRows(workbook, sheetName);
    serverCache.set(cacheKey, rows);
    return rows;
  }

  async readFirstSheet(fileId: string): Promise<{
    rows: string[][];
    sheetName?: string;
    sheetNames: string[];
  }> {
    const workbook = await this.loadWorkbook(fileId);
    const sheetName = workbook.SheetNames[0];
    return {
      rows: this.workbookToRows(workbook, sheetName),
      sheetName,
      sheetNames: workbook.SheetNames,
    };
  }

  private async loadWorkbook(fileId: string): Promise<XLSX.WorkBook> {
    const cacheKey = `excel:${fileId}:workbook`;
    const cached = serverCache.get<XLSX.WorkBook>(cacheKey);
    if (cached) return cached;

    const buffer = await this.downloadFile(fileId);
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
    serverCache.set(cacheKey, workbook);
    return workbook;
  }

  private async downloadFile(fileId: string): Promise<Buffer> {
    const auth = createGoogleAuth();
    const drive = google.drive({ version: "v3", auth });

    const response = await drive.files.get(
      {
        fileId,
        alt: "media",
        supportsAllDrives: true,
      },
      { responseType: "arraybuffer" }
    );

    return Buffer.from(response.data as ArrayBuffer);
  }

  private workbookToRows(workbook: XLSX.WorkBook, sheetName?: string): string[][] {
    const targetName = sheetName ?? workbook.SheetNames[0];
    if (!targetName) return [];

    const sheet = workbook.Sheets[targetName];
    if (!sheet) return [];

    const rawRows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false,
    }) as unknown[][];

    return rawRows.map((row) =>
      row.map((cell) => String(cell ?? "").trim())
    );
  }
}

export const excelReader = new ExcelReader();
