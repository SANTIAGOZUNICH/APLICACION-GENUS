import { extractLabelValuePairs, normalizeSheetLabel } from "@/lib/mappers/sheet-field-resolver";
import type { DiscoveryHeaderAnalysis } from "@/types/discovery/discovery.types";

const MAX_SAMPLE_ROWS = 5;
const HEADER_SCAN_ROWS = 30;

function rowNonEmptyCount(row: string[]): number {
  return row.filter((cell) => cell.trim()).length;
}

function looksLikeHeaderRow(row: string[]): boolean {
  const cells = row.map((c) => c.trim()).filter(Boolean);
  if (cells.length < 2) return false;
  const numeric = cells.filter((c) => /^\d+([.,]\d+)?$/.test(c)).length;
  return numeric / cells.length < 0.5;
}

/** Detect tabular header row(s) in first N rows. */
export function detectHeaderRows(rows: string[][]): number[] {
  const candidates: number[] = [];

  for (let i = 0; i < Math.min(rows.length, HEADER_SCAN_ROWS); i++) {
    const row = rows[i] ?? [];
    if (rowNonEmptyCount(row) >= 2 && looksLikeHeaderRow(row)) {
      candidates.push(i + 1);
    }
  }

  if (candidates.length === 0 && rows.length > 0 && rowNonEmptyCount(rows[0] ?? []) >= 2) {
    return [1];
  }

  return candidates.slice(0, 3);
}

export function extractHeadersFromRow(rows: string[][], headerRowIndex: number): string[] {
  const row = rows[headerRowIndex - 1] ?? [];
  return row.map((cell) => cell.trim()).filter(Boolean);
}

export function extractSampleDataRows(
  rows: string[][],
  headerRowIndex: number,
  maxRows = MAX_SAMPLE_ROWS
): string[][] {
  const start = headerRowIndex;
  return rows.slice(start, start + maxRows).map((row) =>
    row.map((cell) => String(cell ?? "").trim())
  );
}

export function analyzeLabelValueLayout(rows: string[][]): DiscoveryHeaderAnalysis {
  const pairs = extractLabelValuePairs(rows);
  const keys = Object.keys(pairs);
  const sampleRows = Object.entries(pairs)
    .slice(0, MAX_SAMPLE_ROWS)
    .map(([label, value]) => [label, value]);

  return {
    headers: keys,
    sampleRows,
    layout: keys.length >= 2 ? "label_value" : "unknown",
  };
}

export function analyzeTabularLayout(rows: string[][]): DiscoveryHeaderAnalysis {
  const headerRows = detectHeaderRows(rows);
  const headerRowIndex = headerRows[0] ?? 1;
  const headers = extractHeadersFromRow(rows, headerRowIndex);
  const sampleRows = extractSampleDataRows(rows, headerRowIndex);

  return {
    headerRowIndex,
    detectedHeaderRows: headerRows,
    headers,
    sampleRows,
    layout: headers.length >= 2 ? "tabular" : "unknown",
  };
}

export function analyzeSheetLayout(rows: string[][]): DiscoveryHeaderAnalysis {
  const tabular = analyzeTabularLayout(rows);
  const labelValue = analyzeLabelValueLayout(rows);

  if (labelValue.layout === "label_value" && labelValue.headers.length >= tabular.headers.length) {
    return {
      detectedHeaderRows: [],
      headers: labelValue.headers,
      sampleRows: labelValue.sampleRows,
      layout: "label_value",
    };
  }

  return tabular;
}

export function buildValuesByKeyFromTabular(
  rows: string[][],
  headerRowIndex: number
): Record<string, string> {
  const headers = rows[headerRowIndex - 1] ?? [];
  const dataRow = rows[headerRowIndex] ?? [];
  const map: Record<string, string> = {};

  headers.forEach((header, index) => {
    const key = normalizeSheetLabel(header);
    const value = dataRow[index]?.trim();
    if (key && value) {
      map[key] = value;
    }
  });

  return map;
}

export function buildValuesByKeyFromLabelValue(rows: string[][]): Record<string, string> {
  return extractLabelValuePairs(rows);
}
