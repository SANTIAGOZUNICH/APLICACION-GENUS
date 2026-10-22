import type ExcelJS from "exceljs";

/** Evalúa fórmulas aritméticas simples (productos/sumas de celdas) para la preview. */
export function evaluateSimpleFormula(
  sheet: ExcelJS.Worksheet,
  formula: string
): string | null {
  const expr = formula.replace(/\$/g, "").trim();
  if (!/^[\dA-Z+*.\s]+$/i.test(expr)) return null;
  const withValues = expr.replace(/([A-Z]+)(\d+)/gi, (_m, col: string, row: string) => {
    const v = sheet.getCell(`${col.toUpperCase()}${row}`).value;
    if (v == null) return "0";
    if (typeof v === "number") return String(v);
    if (typeof v === "object" && v && "formula" in v) {
      const nested = evaluateSimpleFormula(sheet, (v as ExcelJS.CellFormulaValue).formula);
      return nested ?? "0";
    }
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : "0";
  });
  if (!/^[\d+*.\s]+$/.test(withValues)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const n = Function(`"use strict"; return (${withValues});`)() as number;
    return Number.isFinite(n) ? String(n) : null;
  } catch {
    return null;
  }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


/** Texto visible de una celda tal como lo muestra la planilla (fórmulas con su resultado, fechas d/m/aaaa). */
export function cellDisplayText(sheet: ExcelJS.Worksheet, cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "object" && "formula" in v) {
    const f = v as ExcelJS.CellFormulaValue;
    if (f.result != null) return String(f.result);
    return evaluateSimpleFormula(sheet, f.formula) ?? `=${f.formula}`;
  }
  if (v instanceof Date) {
    const [y, m, d] = v.toISOString().slice(0, 10).split("-");
    return `${d}/${m}/${y}`; // siempre DD/MM/AAAA, sin depender de la región del dispositivo
  }
  if (typeof v === "object" && "richText" in v) {
    return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("");
  }
  return String(v);
}
