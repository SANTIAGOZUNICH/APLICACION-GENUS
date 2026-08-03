import "server-only";

import { google } from "googleapis";
import { createGoogleAuth, hasGoogleCredentials } from "@/lib/adapters/google/google-auth";

/** Scope de escritura SOLO para COAs — no usar en fórmulas. */
const DRIVE_WRITE_SCOPES = ["https://www.googleapis.com/auth/drive"];

export function createGoogleDriveWriteAuth() {
  return createGoogleAuth(DRIVE_WRITE_SCOPES);
}

export function getCoasFolderId(): string | null {
  return process.env.GOOGLE_DRIVE_COAS_FOLDER_ID?.trim() || null;
}

export function assertCoasFolderConfigured(): string {
  const id = getCoasFolderId();
  if (!id) {
    throw new Error(
      "GOOGLE_DRIVE_COAS_FOLDER_ID no configurada. Creá una carpeta COA distinta de fórmulas y compartila como Editor con el Service Account."
    );
  }
  if (
    id === process.env.GOOGLE_DRIVE_FORMULAS_FOLDER_ID?.trim() ||
    id === process.env.GOOGLE_DRIVE_ELABORACION_FOLDER_ID?.trim()
  ) {
    throw new Error(
      "GOOGLE_DRIVE_COAS_FOLDER_ID no puede ser la carpeta de fórmulas ni elaboración."
    );
  }
  return id;
}

export async function getDriveWriteClient() {
  if (!hasGoogleCredentials()) {
    throw new Error("Credenciales Google no configuradas.");
  }
  const auth = createGoogleDriveWriteAuth();
  return google.drive({ version: "v3", auth });
}

export const COA_ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/csv",
]);

export const COA_ALLOWED_EXT = new Set(["pdf", "xls", "xlsx", "csv"]);

export const COA_MAX_BYTES = 25 * 1024 * 1024;

export function validateCoaUpload(params: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): void {
  const ext = params.fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!COA_ALLOWED_EXT.has(ext)) {
    throw new Error(`Extensión no permitida: .${ext}`);
  }
  if (!COA_ALLOWED_MIME.has(params.mimeType) && ext !== "csv") {
    // csv a veces viene como text/plain
    if (!(ext === "csv" && params.mimeType.startsWith("text/"))) {
      throw new Error(`MIME no permitido: ${params.mimeType}`);
    }
  }
  if (params.sizeBytes <= 0 || params.sizeBytes > COA_MAX_BYTES) {
    throw new Error("Tamaño de archivo inválido (máx. 25 MB).");
  }
  if (/[\\/]/.test(params.fileName) || params.fileName.includes("..")) {
    throw new Error("Nombre de archivo inválido.");
  }
}
