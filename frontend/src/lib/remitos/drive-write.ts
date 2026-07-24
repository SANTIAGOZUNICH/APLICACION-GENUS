import "server-only";

import { Readable } from "node:stream";
import { google } from "googleapis";
import { createGoogleAuth, hasGoogleCredentials } from "@/lib/adapters/google/google-auth";

const DRIVE_WRITE_SCOPES = ["https://www.googleapis.com/auth/drive"];

export function createGoogleDriveRemitosAuth() {
  return createGoogleAuth(DRIVE_WRITE_SCOPES);
}

export function getRemitosFolderId(): string | null {
  return process.env.GOOGLE_DRIVE_REMITOS_FOLDER_ID?.trim() || null;
}

export function assertRemitosFolderConfigured(): string {
  const id = getRemitosFolderId();
  if (!id) {
    throw new Error(
      "GOOGLE_DRIVE_REMITOS_FOLDER_ID no configurada. Creá una carpeta Remitos distinta de fórmulas/COAs y compartila como Editor con el Service Account."
    );
  }
  const formulas = process.env.GOOGLE_DRIVE_FORMULAS_FOLDER_ID?.trim();
  const coas = process.env.GOOGLE_DRIVE_COAS_FOLDER_ID?.trim();
  const elaboracion = process.env.GOOGLE_DRIVE_ELABORACION_FOLDER_ID?.trim();
  if (id === formulas || id === coas || id === elaboracion) {
    throw new Error(
      "GOOGLE_DRIVE_REMITOS_FOLDER_ID no puede ser la carpeta de fórmulas, COAs ni elaboración."
    );
  }
  return id;
}

export async function getRemitosDriveWriteClient() {
  if (!hasGoogleCredentials()) {
    throw new Error("Credenciales Google no configuradas.");
  }
  const auth = createGoogleDriveRemitosAuth();
  return google.drive({ version: "v3", auth });
}

export async function uploadRemitoDriveFile(params: {
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<string> {
  const folderId = assertRemitosFolderConfigured();
  const drive = await getRemitosDriveWriteClient();
  const res = await drive.files.create({
    requestBody: {
      name: params.fileName,
      parents: [folderId],
    },
    media: {
      mimeType: params.mimeType,
      body: Readable.from(params.bytes),
    },
    fields: "id",
    supportsAllDrives: true,
  });
  if (!res.data.id) throw new Error("Drive no devolvió id de archivo.");
  return res.data.id;
}

/** Si metadata Neon falla tras upload, trash el archivo Drive (anti-huérfano). */
export async function trashRemitoDriveFile(driveFileId: string): Promise<void> {
  if (!driveFileId || driveFileId.startsWith("mem-")) return;
  try {
    const drive = await getRemitosDriveWriteClient();
    await drive.files.update({
      fileId: driveFileId,
      requestBody: { trashed: true },
      supportsAllDrives: true,
    });
  } catch {
    /* ignore trash errors */
  }
}
