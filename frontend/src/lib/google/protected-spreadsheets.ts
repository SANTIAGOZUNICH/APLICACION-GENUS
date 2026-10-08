/**
 * Planillas ORIGINALES de Google: GENUS nunca escribe en ellas, aunque alguien las ponga por error en una
 * allowlist de write-back. Las pruebas de escritura van siempre contra COPIAS (ver docss/42 §2).
 *
 * - Las dos planillas oficiales de Asignación de Lotes (2025 y 2026), fijas en el código.
 * - `GENUS_PROTECTED_SPREADSHEET_IDS`: ids extra separados por coma (p. ej. la SEMANAS 2026 original).
 * La SEMANAS 2026 indexada desde Drive se protege además en `writeSemanasCell` (se resuelve en runtime).
 */
import "server-only";

import { OFFICIAL_ASIGNACION_LOTES_SPREADSHEETS } from "@/lib/asignacion-lotes/official-sources";

export function protectedOriginalSpreadsheetIds(env: Record<string, string | undefined> = process.env): Set<string> {
  const extra = (env.GENUS_PROTECTED_SPREADSHEET_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return new Set([...OFFICIAL_ASIGNACION_LOTES_SPREADSHEETS.map((s) => s.spreadsheetId), ...extra]);
}

export function isProtectedOriginalSpreadsheet(spreadsheetId: string, env: Record<string, string | undefined> = process.env): boolean {
  return protectedOriginalSpreadsheetIds(env).has(spreadsheetId.trim());
}
