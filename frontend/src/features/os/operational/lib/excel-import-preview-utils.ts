import type { RowValidationIssue } from "./clipboard-import";

export type ExcelPreviewIssue = RowValidationIssue & {
  severity?: "error" | "warning";
};

export type ExcelPreviewRowStatus = "valid" | "warning" | "invalid";

export type ExcelPreviewCounts = {
  total: number;
  selected: number;
  valid: number;
  warnings: number;
  invalid: number;
  selectedImportable: number;
};

export function classifyExcelPreviewIssues(issues: ExcelPreviewIssue[]): ExcelPreviewRowStatus {
  if (issues.some((issue) => (issue.severity ?? "error") === "error")) return "invalid";
  if (issues.some((issue) => issue.severity === "warning")) return "warning";
  return "valid";
}

export function isExcelPreviewImportable(issues: ExcelPreviewIssue[]): boolean {
  return classifyExcelPreviewIssues(issues) !== "invalid";
}

export function computeExcelPreviewCounts<T extends { selected: boolean; issues: ExcelPreviewIssue[] }>(
  rows: T[]
): ExcelPreviewCounts {
  let selected = 0;
  let valid = 0;
  let warnings = 0;
  let invalid = 0;
  let selectedImportable = 0;
  for (const row of rows) {
    const status = classifyExcelPreviewIssues(row.issues);
    if (status === "invalid") invalid += 1;
    else if (status === "warning") warnings += 1;
    else valid += 1;
    if (row.selected) {
      selected += 1;
      if (status !== "invalid") selectedImportable += 1;
    }
  }
  return {
    total: rows.length,
    selected,
    valid,
    warnings,
    invalid,
    selectedImportable,
  };
}

/** Header checkbox: true / false / indeterminate. */
export function selectionMasterState(selected: number, total: number): boolean | "indeterminate" {
  if (total <= 0 || selected <= 0) return false;
  if (selected >= total) return true;
  return "indeterminate";
}

/** Escape/copy cell exactly for Excel-compatible TSV. */
export function tsvEscapeCell(value: string): string {
  if (/[\t\r\n"]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildExcelTsv(headers: string[], rows: string[][]): string {
  const lines = [headers.map(tsvEscapeCell).join("\t")];
  for (const row of rows) {
    lines.push(row.map((cell) => tsvEscapeCell(cell ?? "")).join("\t"));
  }
  return lines.join("\r\n");
}

export function mintImportIdempotencyKey(prefix = "excel-import"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  try {
    if (typeof document === "undefined") return false;
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
