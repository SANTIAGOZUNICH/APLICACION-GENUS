const OE_ID_PATTERN = /OE[-_\s]?(\d{4})[-_\s]?(\d+)/i;

export function parseOeIdFromFileName(fileName: string): string | null {
  const match = fileName.match(OE_ID_PATTERN);
  if (!match) return null;
  const sequence = match[2].padStart(4, "0");
  return `OE-${match[1]}-${sequence}`;
}

export function normalizeOeId(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(OE_ID_PATTERN);
  if (match) {
    return `OE-${match[1]}-${match[2].padStart(4, "0")}`;
  }
  return trimmed.toUpperCase();
}
