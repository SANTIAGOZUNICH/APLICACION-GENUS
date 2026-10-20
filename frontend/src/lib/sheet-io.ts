/**
 * Exportar / importar planillas (CSV y XLSX). Solo lectura de datos y generación de archivos en el navegador:
 * nunca escribe en el servidor. La importación entrega TEXTO tabulado que pasa por la vista previa existente
 * (nunca reemplaza el inventario; solo agrega filas nuevas tras confirmar).
 */

/** Escapa una celda para CSV (comillas, comas, saltos de línea). */
export function csvCell(value: string): string {
  return /[",\n\r;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV con BOM UTF-8 (Excel respeta tildes) y coma como separador. */
export function rowsToCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((r) => r.map((c) => csvCell(String(c ?? ""))).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Texto tabulado (lo que entiende «Pegar desde Excel»). Quita tabulaciones y saltos dentro de las celdas. */
export function rowsToTsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => String(c ?? "").replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
}

/** Nombre de archivo seguro y con fecha: «stock-mp-2026-10-20.csv». */
export function exportFileName(base: string, ext: "csv" | "xlsx", now = new Date()): string {
  const slug = base.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "planilla";
  return `${slug}-${now.toISOString().slice(0, 10)}.${ext}`;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadCsv(name: string, headers: string[], rows: string[][]) {
  download(new Blob([rowsToCsv(headers, rows)], { type: "text/csv;charset=utf-8" }), name);
}

export async function downloadXlsx(name: string, sheetName: string, headers: string[], rows: string[][]) {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31) || "Planilla");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  download(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name);
}

/** Primera hoja de un .xlsx como texto tabulado (para la vista previa de importación). */
export async function xlsxToTsv(data: ArrayBuffer): Promise<string> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(data, { type: "array", cellDates: false });
  const first = wb.SheetNames[0];
  if (!first) return "";
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[first]!, { header: 1, raw: false, defval: "" });
  return rowsToTsv(aoa.map((r) => (r as unknown[]).map((c) => String(c ?? ""))));
}
