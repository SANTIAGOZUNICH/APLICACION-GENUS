import "server-only";

import { google } from "googleapis";

function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!id) {
    throw new Error(
      "GOOGLE_SHEETS_SPREADSHEET_ID no está configurado."
    );
  }
  return id;
}

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

function createGoogleAuth() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(
    /\\n/g,
    "\n"
  ).trim();

  if (clientEmail && privateKey) {
    return new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
  }

  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (credentialsPath) {
    return new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
  }

  throw new Error(
    "Credenciales de Google no configuradas. Definí GOOGLE_SERVICE_ACCOUNT_EMAIL/PRIVATE_KEY o GOOGLE_APPLICATION_CREDENTIALS."
  );
}

export async function readSheetTab(tabName: string): Promise<string[][]> {
  const auth = createGoogleAuth();

  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: tabName,
  });

  return (response.data.values as string[][]) ?? [];
}

export async function readOperationsTabs() {
  const tabs = getSheetsTabNames();
  const [lotesRows, saldosRows, movimientosRows] = await Promise.all([
    readSheetTab(tabs.lotes),
    readSheetTab(tabs.saldos),
    readSheetTab(tabs.movimientos),
  ]);

  return {
    tabs,
    lotesRows,
    saldosRows,
    movimientosRows,
  };
}
