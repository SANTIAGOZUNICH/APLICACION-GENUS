/** Utilities to locate OE documents by file metadata — not by business OE_ID pattern. */

export function stripSheetExtension(fileName: string): string {
  return fileName.replace(/\.(gsheet|xlsx|xls|csv)$/i, "").trim();
}

/** URL-safe slug derived from file name (for lookup only). */
export function fileNameToSlug(fileName: string): string {
  return stripSheetExtension(fileName)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function normalizeLookupKey(value: string): string {
  try {
    return decodeURIComponent(value.trim());
  } catch {
    return value.trim();
  }
}

/** Google Drive file IDs are typically 25+ alphanumeric/_- chars. */
export function looksLikeDriveFileId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{20,}$/.test(value);
}
