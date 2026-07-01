import "server-only";

import { google } from "googleapis";
import { createGoogleAuth } from "@/lib/adapters/google/google-auth";
import { serverCache } from "@/lib/adapters/drive/cache/server-cache";

const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";

export interface SemanasMergeRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  range: string;
}

export class SheetsReader {
  async getSpreadsheetMeta(spreadsheetId: string): Promise<{
    tabs: string[];
    mergesByTab: Record<string, SemanasMergeRange[]>;
  }> {
    const cacheKey = `sheet:${spreadsheetId}:meta`;
    const cached = serverCache.get<{
      tabs: string[];
      mergesByTab: Record<string, SemanasMergeRange[]>;
    }>(cacheKey);
    if (cached) return cached;

    const auth = createGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties.title,sheets.merges",
    });

    const tabs: string[] = [];
    const mergesByTab: Record<string, SemanasMergeRange[]> = {};

    for (const sheet of meta.data.sheets ?? []) {
      const title = sheet.properties?.title;
      if (!title) continue;
      tabs.push(title);
      mergesByTab[title] = (sheet.merges ?? []).map((merge) => ({
        startRow: (merge.startRowIndex ?? 0) + 1,
        endRow: merge.endRowIndex ?? 0,
        startColumn: (merge.startColumnIndex ?? 0) + 1,
        endColumn: merge.endColumnIndex ?? 0,
        range: mergeRangeToA1(
          title,
          merge.startRowIndex ?? 0,
          merge.endRowIndex ?? 0,
          merge.startColumnIndex ?? 0,
          merge.endColumnIndex ?? 0
        ),
      }));
    }

    const result = { tabs, mergesByTab };
    serverCache.set(cacheKey, result);
    return result;
  }

  async readRange(spreadsheetId: string, range: string): Promise<string[][]> {
    const cacheKey = `sheet:${spreadsheetId}:range:${range}`;
    const cached = serverCache.get<string[][]>(cacheKey);
    if (cached) return cached;

    const auth = createGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const values = (response.data.values as string[][]) ?? [];
    serverCache.set(cacheKey, values);
    return values;
  }

  async readTab(spreadsheetId: string, tabName: string): Promise<string[][]> {
    return this.readRange(spreadsheetId, tabName);
  }

  async readFirstTab(spreadsheetId: string): Promise<string[][]> {
    const tabs = await this.listTabs(spreadsheetId);
    const firstTitle = tabs[0];
    if (!firstTitle) {
      return [];
    }

    return this.readTab(spreadsheetId, firstTitle);
  }

  async listTabs(spreadsheetId: string): Promise<string[]> {
    const cacheKey = `sheet:${spreadsheetId}:tabs`;
    const cached = serverCache.get<string[]>(cacheKey);
    if (cached) return cached;

    const auth = createGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties.title",
    });

    const titles =
      meta.data.sheets
        ?.map((sheet) => sheet.properties?.title)
        .filter((title): title is string => Boolean(title)) ?? [];

    serverCache.set(cacheKey, titles);
    return titles;
  }
}

export const sheetsReader = new SheetsReader();
export { SPREADSHEET_MIME };

function columnIndexToLetter(index: number): string {
  let result = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function mergeRangeToA1(
  tab: string,
  startRow: number,
  endRow: number,
  startCol: number,
  endCol: number
): string {
  const start = `${columnIndexToLetter(startCol)}${startRow + 1}`;
  const end = `${columnIndexToLetter(endCol - 1)}${endRow}`;
  return `'${tab.replace(/'/g, "''")}'!${start}:${end}`;
}
