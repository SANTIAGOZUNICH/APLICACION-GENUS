import "server-only";

import type { FolderAlias } from "@/lib/adapters/drive/types/document.types";

/** Expected paths relative to GENUS — used for diagnostics only. */
export const EXPECTED_FOLDER_PATHS: readonly string[] = [
  "PRODUCCION 2026/ELABORACION",
  "PRODUCCION 2026/PCP",
  "PRODUCCION 2026/LOTES",
  "PRODUCTOS",
  "DESARROLLO",
  "CALIDAD",
] as const;

/** Alias → relative path under GENUS (case-insensitive match). */
export const FOLDER_ALIAS_PATHS: Record<FolderAlias, string> = {
  genus: "",
  produccion_2026: "PRODUCCION 2026",
  elaboracion: "PRODUCCION 2026/ELABORACION",
  pcp: "PRODUCCION 2026/PCP",
  lotes: "PRODUCCION 2026/LOTES",
  productos: "PRODUCTOS",
  desarrollo: "DESARROLLO",
  calidad: "CALIDAD",
};

/** Optional env overrides — never required if GENUS root is configured. */
const FOLDER_OVERRIDE_ENV: Partial<Record<FolderAlias, string>> = {
  genus: "GOOGLE_DRIVE_GENUS_FOLDER_ID",
  produccion_2026: "GOOGLE_DRIVE_PRODUCCION_2026_FOLDER_ID",
  elaboracion: "GOOGLE_DRIVE_ELABORACION_FOLDER_ID",
  pcp: "GOOGLE_DRIVE_PCP_FOLDER_ID",
  lotes: "GOOGLE_DRIVE_LOTES_FOLDER_ID",
  productos: "GOOGLE_DRIVE_PRODUCTOS_FOLDER_ID",
  desarrollo: "GOOGLE_DRIVE_DESARROLLO_FOLDER_ID",
};

const CRITICAL_SHEET_ENV = {
  asignacion_lotes_2026: "GOOGLE_SHEETS_ASIGNACION_LOTES_2026_ID",
  pedidos_2026: "GOOGLE_SHEETS_PEDIDOS_2026_ID",
  semanas_2026: "GOOGLE_SHEETS_SEMANAS_2026_ID",
} as const;

export const CRITICAL_SHEET_NAMES = {
  asignacion_lotes_2026: "ASIGNACION DE LOTES 2026",
  pedidos_2026: "PEDIDOS 2026",
  semanas_2026: "SEMANAS 2026",
} as const;

export const CRITICAL_SHEET_FOLDER: Record<
  keyof typeof CRITICAL_SHEET_NAMES,
  FolderAlias
> = {
  asignacion_lotes_2026: "lotes",
  pedidos_2026: "pcp",
  semanas_2026: "pcp",
};

const ALIAS_LOOKUP: Record<string, FolderAlias> = {
  genus: "genus",
  produccion_2026: "produccion_2026",
  produccion: "produccion_2026",
  "produccion 2026": "produccion_2026",
  elaboracion: "elaboracion",
  pcp: "pcp",
  lotes: "lotes",
  productos: "productos",
  desarrollo: "desarrollo",
  calidad: "calidad",
};

export function getMaxIndexDepth(): number {
  const value = Number(process.env.GENUS_DRIVE_MAX_INDEX_DEPTH ?? "4");
  if (Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return 4;
}

/** Required config — single GENUS root folder. */
export function getGenusFolderId(): string | null {
  return process.env.GOOGLE_DRIVE_GENUS_FOLDER_ID?.trim() || null;
}

export function getFolderOverrideId(alias: FolderAlias): string | null {
  const envKey = FOLDER_OVERRIDE_ENV[alias];
  if (!envKey || alias === "genus") {
    return alias === "genus" ? getGenusFolderId() : null;
  }
  return process.env[envKey]?.trim() || null;
}

export function getCriticalSheetFastPathId(
  sheetKey: keyof typeof CRITICAL_SHEET_NAMES
): string | null {
  const envKey = CRITICAL_SHEET_ENV[sheetKey];
  return process.env[envKey]?.trim() || null;
}

export function hasAnyCriticalSheetFastPath(): boolean {
  return Object.values(CRITICAL_SHEET_ENV).some((key) =>
    Boolean(process.env[key]?.trim())
  );
}

export function isDriveRepositoryConfigured(): boolean {
  return Boolean(getGenusFolderId()) || hasAnyCriticalSheetFastPath();
}

export function resolveFolderAlias(input: string): FolderAlias | null {
  const normalized = input.trim().toLowerCase();

  if (ALIAS_LOOKUP[normalized]) {
    return ALIAS_LOOKUP[normalized];
  }

  const pathMatch = Object.entries(FOLDER_ALIAS_PATHS).find(
    ([, path]) => path.toLowerCase() === normalized
  );
  if (pathMatch) {
    return pathMatch[0] as FolderAlias;
  }

  return null;
}

export function normalizeRelativePath(path: string): string {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
}

/** @deprecated Use resolveFolderAlias */
export function resolveFolderKey(input: string): FolderAlias | null {
  return resolveFolderAlias(input);
}

/** @deprecated E7 single-spreadsheet config */
export function getLegacySpreadsheetId(): string | null {
  return process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() || null;
}

export type CriticalSheetKey = keyof typeof CRITICAL_SHEET_NAMES;
