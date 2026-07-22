import "server-only";

import { hasGoogleCredentials, createGoogleAuth } from "@/lib/adapters/google/google-auth";
import { GoogleDriveGateway, OFFICE_SHEET_MIMES, FOLDER_MIME } from "@/lib/adapters/drive/google-drive-gateway";
import { google } from "googleapis";

export type DriveFormulasDiagnose = {
  folderConfigured: boolean;
  folderEnvKey: string | null;
  serviceAccountConfigured: boolean;
  serviceAccountAccess: boolean;
  clientFoldersVisible: number;
  excelFilesVisible: number;
  googleSheetsVisible: number;
  estructuraCompatible: boolean;
  notes: string[];
};

const XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLS = "application/vnd.ms-excel";
const GSHEET = "application/vnd.google-apps.spreadsheet";

/**
 * Resuelve la carpeta raíz de fórmulas maestras.
 * Preferir GOOGLE_DRIVE_FORMULAS_FOLDER_ID.
 * No usar ELABORACION (órdenes operativas por mes/lote).
 */
export function resolveFormulasFolderId(): {
  folderId: string | null;
  envKey: string | null;
} {
  const formulas = process.env.GOOGLE_DRIVE_FORMULAS_FOLDER_ID?.trim();
  if (formulas) return { folderId: formulas, envKey: "GOOGLE_DRIVE_FORMULAS_FOLDER_ID" };
  const productos = process.env.GOOGLE_DRIVE_PRODUCTOS_FOLDER_ID?.trim();
  if (productos) return { folderId: productos, envKey: "GOOGLE_DRIVE_PRODUCTOS_FOLDER_ID" };
  // Explicitamente NO usar GOOGLE_DRIVE_ELABORACION_FOLDER_ID:
  // suele contener OE operativas por mes, no el banco de fórmulas por cliente.
  return { folderId: null, envKey: null };
}

export function getServiceAccountEmailSafe(): string | null {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  return email || null;
}

/** Diagnóstico READ-ONLY: solo conteos y booleans. Sin nombres de archivo ni fórmulas. */
export async function diagnoseDriveFormulasAccess(): Promise<DriveFormulasDiagnose> {
  const notes: string[] = [];
  const { folderId, envKey } = resolveFormulasFolderId();
  const serviceAccountConfigured = hasGoogleCredentials();

  if (!folderId) {
    notes.push(
      "Definí GOOGLE_DRIVE_FORMULAS_FOLDER_ID apuntando a la carpeta raíz de fórmulas maestras (subcarpetas por CLIENTE, no por mes)."
    );
    notes.push(
      "No uses GOOGLE_DRIVE_ELABORACION_FOLDER_ID: contiene órdenes operativas (ABRIL/MAYO/…), no el banco histórico por cliente."
    );
    const elaboracion = process.env.GOOGLE_DRIVE_ELABORACION_FOLDER_ID?.trim();
    if (elaboracion) {
      notes.push(
        "GOOGLE_DRIVE_ELABORACION_FOLDER_ID está configurada pero se ignora a propósito para sugerencias de fórmulas."
      );
    }
    return {
      folderConfigured: false,
      folderEnvKey: null,
      serviceAccountConfigured,
      serviceAccountAccess: false,
      clientFoldersVisible: 0,
      excelFilesVisible: 0,
      googleSheetsVisible: 0,
      estructuraCompatible: false,
      notes,
    };
  }

  if (!serviceAccountConfigured) {
    notes.push("Faltan GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.");
    return {
      folderConfigured: true,
      folderEnvKey: envKey,
      serviceAccountConfigured: false,
      serviceAccountAccess: false,
      clientFoldersVisible: 0,
      excelFilesVisible: 0,
      googleSheetsVisible: 0,
      estructuraCompatible: false,
      notes,
    };
  }

  const gateway = new GoogleDriveGateway();
  let serviceAccountAccess = false;
  try {
    serviceAccountAccess = await gateway.canAccessFolder(folderId);
  } catch {
    serviceAccountAccess = false;
  }

  if (!serviceAccountAccess) {
    const email = getServiceAccountEmailSafe();
    notes.push(
      `La carpeta configurada en ${envKey} no es accesible. Compartila (Viewer) con el Service Account.`
    );
    if (email) {
      notes.push(`Service Account email (compartir carpeta con): ${email}`);
    } else {
      notes.push(
        "Buscá GOOGLE_SERVICE_ACCOUNT_EMAIL en Vercel → Project → Settings → Environment Variables (Preview)."
      );
    }
    return {
      folderConfigured: true,
      folderEnvKey: envKey,
      serviceAccountConfigured: true,
      serviceAccountAccess: false,
      clientFoldersVisible: 0,
      excelFilesVisible: 0,
      googleSheetsVisible: 0,
      estructuraCompatible: false,
      notes,
    };
  }

  // Contar subcarpetas (clientes) y archivos de hoja (muestra superficial, sin abrir Excel).
  const folders = await gateway.listSubfolders(folderId);
  let excel = 0;
  let gsheets = 0;
  const sample = folders.slice(0, 15);
  for (const f of sample) {
    const files = await listSheetFilesInFolder(f.folderId);
    for (const file of files) {
      if (file.mimeType === GSHEET) gsheets += 1;
      else if (file.mimeType === XLSX || file.mimeType === XLS) excel += 1;
    }
  }

  // Si no hay subcarpetas, contar archivos directos en la raíz.
  if (folders.length === 0) {
    const rootFiles = await listSheetFilesInFolder(folderId);
    for (const file of rootFiles) {
      if (file.mimeType === GSHEET) gsheets += 1;
      else if (file.mimeType === XLSX || file.mimeType === XLS) excel += 1;
    }
    notes.push(
      "La carpeta no tiene subcarpetas de cliente; los archivos están en la raíz (estructura no ideal)."
    );
  } else if (sample.length < folders.length) {
    notes.push(
      `Conteo de archivos sobre muestra de ${sample.length}/${folders.length} subcarpetas (no se abrieron Excel).`
    );
  }

  const MONTHISH =
    /^(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)(\s*\d{2,4})?$/i;
  const monthFolders = folders.filter((f) => MONTHISH.test(f.name.trim())).length;
  if (monthFolders >= Math.max(3, Math.floor(folders.length * 0.5))) {
    notes.push(
      "Las subcarpetas parecen meses (órdenes operativas), no clientes. Configurá GOOGLE_DRIVE_FORMULAS_FOLDER_ID con el banco por cliente."
    );
    return {
      folderConfigured: true,
      folderEnvKey: envKey,
      serviceAccountConfigured: true,
      serviceAccountAccess: true,
      clientFoldersVisible: folders.length,
      excelFilesVisible: excel,
      googleSheetsVisible: gsheets,
      estructuraCompatible: false,
      notes,
    };
  }

  const estructuraCompatible =
    folders.length > 0 && excel + gsheets > 0;

  if (!estructuraCompatible && folders.length > 0 && excel + gsheets === 0) {
    notes.push(
      "Hay subcarpetas pero no se vieron XLS/XLSX/Google Sheets en la muestra. Verificar contenido o permisos."
    );
  }

  if (envKey !== "GOOGLE_DRIVE_FORMULAS_FOLDER_ID") {
    notes.push(
      `Usando ${envKey} como fallback. Preferí GOOGLE_DRIVE_FORMULAS_FOLDER_ID dedicado a fórmulas maestras.`
    );
  }

  return {
    folderConfigured: true,
    folderEnvKey: envKey,
    serviceAccountConfigured: true,
    serviceAccountAccess: true,
    clientFoldersVisible: folders.length,
    excelFilesVisible: excel,
    googleSheetsVisible: gsheets,
    estructuraCompatible,
    notes,
  };
}

async function listSheetFilesInFolder(
  folderId: string
): Promise<Array<{ mimeType: string }>> {
  const auth = createGoogleAuth();
  const drive = google.drive({ version: "v3", auth });
  const mimeQuery = [...OFFICE_SHEET_MIMES]
    .map((m) => `mimeType='${m}'`)
    .join(" or ");
  const response = await drive.files.list({
    q: `'${folderId}' in parents and (${mimeQuery}) and trashed=false`,
    fields: "files(id,mimeType)",
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return (response.data.files ?? [])
    .filter((f) => f.mimeType)
    .map((f) => ({ mimeType: f.mimeType! }));
}

void FOLDER_MIME;
