/**
 * Utilidades de importación desde Excel / Sheets (pegar o CSV).
 * Detecta TSV, CSV con ; o ,, encabezados y mapeo de columnas.
 */

export type Delimiter = "\t" | ";" | ",";

export interface ParsedGrid {
  delimiter: Delimiter;
  headers: string[];
  rows: string[][];
  /** true si la primera fila parece encabezado textual. */
  hasHeaderRow: boolean;
}

export interface ColumnMapping {
  /** Índice de columna en el grid → clave de campo destino. */
  [fieldKey: string]: number | null;
}

export interface RowValidationIssue {
  rowIndex: number;
  field?: string;
  message: string;
}

export function detectDelimiter(text: string): Delimiter {
  const firstLine = text.split(/\r\n|\n|\r/).find((l) => l.trim()) ?? "";
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const semis = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  if (tabs >= semis && tabs >= commas && tabs > 0) return "\t";
  if (semis >= commas && semis > 0) return ";";
  return ",";
}

function splitLine(line: string, delimiter: Delimiter): string[] {
  if (delimiter === "\t") return line.split("\t").map((c) => c.trim());
  // CSV simple con comillas
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  result.push(current.trim());
  return result;
}

function looksLikeHeader(cells: string[]): boolean {
  if (cells.length === 0) return false;
  const joined = cells.join(" ").toLowerCase();
  const headerHints = [
    "codigo",
    "código",
    "producto",
    "lote",
    "cantidad",
    "fecha",
    "materia",
    "cliente",
    "marca",
    "vto",
    "observ",
  ];
  return headerHints.some((h) => joined.includes(h));
}

export function parseGrid(text: string, forceDelimiter?: Delimiter): ParsedGrid {
  const delimiter = forceDelimiter ?? detectDelimiter(text);
  const lines = text
    .split(/\r\n|\n|\r/)
    .map((l) => l.replace(/\u00a0/g, " "))
    .filter((l) => l.trim().length > 0);

  const matrix = lines.map((line) => splitLine(line, delimiter));
  if (matrix.length === 0) {
    return { delimiter, headers: [], rows: [], hasHeaderRow: false };
  }

  const hasHeaderRow = looksLikeHeader(matrix[0]!);
  if (hasHeaderRow) {
    return {
      delimiter,
      headers: matrix[0]!.map((h) => h.trim()),
      rows: matrix.slice(1),
      hasHeaderRow: true,
    };
  }

  const colCount = Math.max(...matrix.map((r) => r.length));
  return {
    delimiter,
    headers: Array.from({ length: colCount }, (_, i) => `Columna ${i + 1}`),
    rows: matrix,
    hasHeaderRow: false,
  };
}

export function normalizeHeaderKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Intenta mapear encabezados a claves de destino usando alias. */
export function autoMapColumns(
  headers: string[],
  fieldAliases: Record<string, string[]>
): ColumnMapping {
  const mapping: ColumnMapping = {};
  const normalizedHeaders = headers.map(normalizeHeaderKey);

  for (const [field, aliases] of Object.entries(fieldAliases)) {
    mapping[field] = null;
    const normalizedAliases = aliases.map(normalizeHeaderKey);
    for (let i = 0; i < normalizedHeaders.length; i++) {
      const h = normalizedHeaders[i]!;
      if (normalizedAliases.some((a) => h === a || h.includes(a) || a.includes(h))) {
        mapping[field] = i;
        break;
      }
    }
  }
  return mapping;
}

export function rowToObject(
  row: string[],
  mapping: ColumnMapping
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, idx] of Object.entries(mapping)) {
    out[field] = idx === null || idx === undefined ? "" : (row[idx] ?? "").trim();
  }
  return out;
}

export function parseNonNegativeNumber(raw: string): number | null {
  if (!raw.trim()) return null;
  const normalized = raw.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  // If original had only one comma as decimal, previous replace of dots may be wrong for "1.234,5"
  // Retry EU format: dots as thousands, comma as decimal
  const eu = raw.replace(/\s/g, "");
  let value: number;
  if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(eu)) {
    value = Number.parseFloat(eu.replace(/\./g, "").replace(",", "."));
  } else if (/^\d+([.,]\d+)?$/.test(eu)) {
    value = Number.parseFloat(eu.replace(",", "."));
  } else {
    value = Number.parseFloat(normalized);
  }
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}
