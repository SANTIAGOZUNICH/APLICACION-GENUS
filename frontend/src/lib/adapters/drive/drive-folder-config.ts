import "server-only";

import type {
  CriticalSheetKey,
  OperationsFolderKey,
} from "@/lib/adapters/drive/types/document.types";

const FOLDER_ENV: Record<OperationsFolderKey, string> = {
  genus: "GOOGLE_DRIVE_GENUS_FOLDER_ID",
  produccion_2026: "GOOGLE_DRIVE_PRODUCCION_2026_FOLDER_ID",
  elaboracion: "GOOGLE_DRIVE_ELABORACION_FOLDER_ID",
  pcp: "GOOGLE_DRIVE_PCP_FOLDER_ID",
  lotes: "GOOGLE_DRIVE_LOTES_FOLDER_ID",
  productos: "GOOGLE_DRIVE_PRODUCTOS_FOLDER_ID",
  desarrollo: "GOOGLE_DRIVE_DESARROLLO_FOLDER_ID",
};

const CRITICAL_SHEET_ENV: Record<CriticalSheetKey, string> = {
  asignacion_lotes_2026: "GOOGLE_SHEETS_ASIGNACION_LOTES_2026_ID",
  pedidos_2026: "GOOGLE_SHEETS_PEDIDOS_2026_ID",
  semanas_2026: "GOOGLE_SHEETS_SEMANAS_2026_ID",
};

export const CRITICAL_SHEET_NAMES: Record<CriticalSheetKey, string> = {
  asignacion_lotes_2026: "ASIGNACION DE LOTES 2026",
  pedidos_2026: "PEDIDOS 2026",
  semanas_2026: "SEMANAS 2026",
};

export const CRITICAL_SHEET_FOLDER: Record<CriticalSheetKey, OperationsFolderKey> =
  {
    asignacion_lotes_2026: "lotes",
    pedidos_2026: "pcp",
    semanas_2026: "pcp",
  };

const ALIAS_FOLDER: Record<string, OperationsFolderKey> = {
  genus: "genus",
  produccion_2026: "produccion_2026",
  produccion: "produccion_2026",
  elaboracion: "elaboracion",
  pcp: "pcp",
  lotes: "lotes",
  productos: "productos",
  desarrollo: "desarrollo",
};

export function resolveFolderKey(input: string): OperationsFolderKey | null {
  return ALIAS_FOLDER[input.trim().toLowerCase()] ?? null;
}

export function getFolderId(folderKey: OperationsFolderKey): string | null {
  const envKey = FOLDER_ENV[folderKey];
  const value = process.env[envKey]?.trim();
  return value || null;
}

export function getCriticalSheetFastPathId(
  sheetKey: CriticalSheetKey
): string | null {
  const envKey = CRITICAL_SHEET_ENV[sheetKey];
  const value = process.env[envKey]?.trim();
  return value || null;
}

export function hasAnyFolderConfigured(): boolean {
  return (Object.keys(FOLDER_ENV) as OperationsFolderKey[]).some((key) =>
    Boolean(getFolderId(key))
  );
}

export function hasAnyCriticalSheetFastPath(): boolean {
  return (Object.keys(CRITICAL_SHEET_ENV) as CriticalSheetKey[]).some((key) =>
    Boolean(getCriticalSheetFastPathId(key))
  );
}

export function isDriveRepositoryConfigured(): boolean {
  return hasAnyFolderConfigured() || hasAnyCriticalSheetFastPath();
}

/** @deprecated E7 single-spreadsheet config — do not use in E7.1+ */
export function getLegacySpreadsheetId(): string | null {
  return process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() || null;
}
