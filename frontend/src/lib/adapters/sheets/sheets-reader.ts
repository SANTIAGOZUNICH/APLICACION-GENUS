import "server-only";

import { google } from "googleapis";
import { createGoogleAuth } from "@/lib/adapters/google/google-auth";
import { serverCache } from "@/lib/adapters/drive/cache/server-cache";

const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";

export class SheetsReader {
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
