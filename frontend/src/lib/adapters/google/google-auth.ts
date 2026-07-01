import "server-only";

import { google } from "googleapis";

const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];
const SHEETS_SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];
const ALL_SCOPES = [...DRIVE_SCOPES, ...SHEETS_SCOPES];

function getCredentials():
  | { client_email: string; private_key: string }
  | { keyFile: string } {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(
    /\\n/g,
    "\n"
  ).trim();

  if (clientEmail && privateKey) {
    return { client_email: clientEmail, private_key: privateKey };
  }

  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (credentialsPath) {
    return { keyFile: credentialsPath };
  }

  throw new Error(
    "Credenciales de Google no configuradas. Definí GOOGLE_SERVICE_ACCOUNT_EMAIL/PRIVATE_KEY o GOOGLE_APPLICATION_CREDENTIALS."
  );
}

export function createGoogleAuth(scopes: string[] = ALL_SCOPES) {
  const credentials = getCredentials();

  if ("keyFile" in credentials) {
    return new google.auth.GoogleAuth({
      keyFile: credentials.keyFile,
      scopes,
    });
  }

  return new google.auth.GoogleAuth({
    credentials,
    scopes,
  });
}

export function hasGoogleCredentials(): boolean {
  return Boolean(
    (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() &&
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim()) ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()
  );
}
