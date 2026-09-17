/**
 * Extrae el spreadsheetId de una URL de Google Sheets pegada por el usuario.
 * NUNCA le pedimos que copie el id interno a mano — si ya viene un id "puro"
 * (sin barras ni espacios), se acepta tal cual.
 */
export function extractSpreadsheetId(urlOrId: string): string | null {
  const trimmed = urlOrId.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match?.[1]) return match[1];

  // Ya es un id "puro" (sin espacios ni barras) — Google ids reales son
  // alfanuméricos + "-"/"_", típicamente 20+ caracteres.
  if (/^[a-zA-Z0-9-_]{10,}$/.test(trimmed) && !trimmed.includes("/")) {
    return trimmed;
  }

  return null;
}
