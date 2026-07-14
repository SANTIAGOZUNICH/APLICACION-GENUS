import { normalizePersonName } from "@/lib/operational/display-fields";

const WEEK_DAYS = ["lunes", "martes", "miercoles", "jueves", "viernes"] as const;

export function normalizeCellText(value: string): string {
  return value.trim();
}

export function rowText(row: string[]): string {
  return row.map((c) => c.trim()).filter(Boolean).join(" ").toLowerCase();
}

export function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function isWeekAnchorRow(row: string[]): boolean {
  const text = normalizeKey(rowText(row));
  return WEEK_DAYS.every((day) => text.includes(day));
}

export function extractDayColumns(row: string[]): Map<number, string> {
  const map = new Map<number, string>();
  row.forEach((cell, index) => {
    const key = normalizeKey(cell);
    if (key === "lunes") map.set(index, "Lunes");
    else if (key === "martes") map.set(index, "Martes");
    else if (key === "miercoles" || key === "miércoles") map.set(index, "Miércoles");
    else if (key === "jueves") map.set(index, "Jueves");
    else if (key === "viernes") map.set(index, "Viernes");
  });
  return map;
}

export function isQuantityCell(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^\d+([.,]\d+)?$/.test(t)) return true;
  if (/\d+\s*(kg|g|ml|u\b|unidades?)/i.test(t)) return true;
  if (/\d+\s*x\s*\d+/i.test(t)) return true;
  if (/^\d+\s*c\/u/i.test(t)) return true;
  return false;
}

export function isOperationalNote(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/!!/.test(t)) return true;
  if (/videos?/i.test(t)) return true;
  if (/hacer\s+/i.test(t)) return true;
  return false;
}

export function detectPackagingSectorHeader(row: string[]): "ENVASADO_MASIVO" | "ENVASADO_PREMIUM" | null {
  const text = normalizeKey(rowText(row));
  if (text.includes("envasado consumo masivo") || text.includes("consumo masivo")) {
    return "ENVASADO_MASIVO";
  }
  if (text.includes("envasado productos premiun") || text.includes("productos premiun") || text.includes("premium")) {
    return "ENVASADO_PREMIUM";
  }
  return null;
}

export function parseLineFromCell(cell: string): string | null {
  const normalized = normalizeKey(cell);
  const lineMatch = normalized.match(/^linea\s*(?:n[°º]?\s*)?(\d+)\b/);
  if (lineMatch) return `Línea ${lineMatch[1]}`;

  const shortMatch = normalized.match(/^l(\d+)$/);
  if (shortMatch) return `Línea ${shortMatch[1]}`;

  const premiumMatch = normalized.match(/^premium\s*([ab])$/);
  if (premiumMatch) return `Premium ${premiumMatch[1].toUpperCase()}`;

  return null;
}

const DAY_LABELS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"] as const;

/** Fila con fechas ISO o dd/mm en varias columnas (geometría columnar nueva). */
export function isDateHeaderRow(row: string[]): boolean {
  let dateCount = 0;
  for (const cell of row) {
    const t = cell.trim();
    if (!t) continue;
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) dateCount += 1;
    else if (/^\d{1,2}\/\d{1,2}/.test(t)) dateCount += 1;
  }
  return dateCount >= 3;
}

/** Mapea columnas con fechas a días de la semana (Lunes→Viernes). */
export function extractDayColumnsFromDateRow(row: string[]): Map<number, string> {
  const map = new Map<number, string>();
  const cols: number[] = [];
  row.forEach((cell, index) => {
    const t = cell.trim();
    if (!t) return;
    if (/^\d{4}-\d{2}-\d{2}/.test(t) || /^\d{1,2}\/\d{1,2}/.test(t)) {
      cols.push(index);
    }
  });
  cols.slice(0, 5).forEach((col, idx) => {
    map.set(col, DAY_LABELS[idx] ?? `Día ${idx + 1}`);
  });
  return map;
}

/**
 * En fila L1/L2/L3, infiere columnas de día desde celdas de cliente/producto
 * (geometría C/E/G/I/K cuando el encabezado clásico B/D/F/H/J no aplica).
 */
export function inferDayColumnsFromLineRow(row: string[]): Map<number, string> {
  const map = new Map<number, string>();
  const lineCol = row.findIndex((cell) => parseLineFromCell(cell.trim()));
  const productCols: number[] = [];

  row.forEach((cell, index) => {
    const text = normalizeCellText(cell);
    if (!text) return;
    if (parseLineFromCell(text)) return;
    if (index <= lineCol) return;
    if (isOperationalNote(text)) return;
    if (/^📅/.test(text) || /^resumen/i.test(text)) return;
    productCols.push(index);
  });

  productCols.slice(0, 5).forEach((col, idx) => {
    map.set(col, DAY_LABELS[idx] ?? `Día ${idx + 1}`);
  });
  return map;
}

/** ¿El bloque del sheet define líneas explícitas (L1/L2/L3) entre sector y la fila del ítem? */
export function blockExpectsExplicitLine(
  rows: string[][],
  sectorRowIndex: number,
  itemRowIndex: number
): boolean {
  const banner = normalizeKey(rowText(rows[sectorRowIndex] ?? []));
  if (/\d+\s*lineas?\s*de\s*producci/.test(banner)) return true;

  for (let i = sectorRowIndex; i < itemRowIndex; i++) {
    if (detectLineHeader(rows[i] ?? [])) return true;
  }
  return false;
}

/** Encuentra la fila del encabezado de sector más cercana hacia arriba. */
export function findPackagingSectorRow(rows: string[][], itemRowIndex: number): number | null {
  for (let i = itemRowIndex - 1; i >= 0; i--) {
    if (detectPackagingSectorHeader(rows[i] ?? [])) return i;
    if (isWeekAnchorRow(rows[i] ?? [])) break;
  }
  return null;
}

/** Detecta encabezado de línea en cualquier celda — Sector → Línea → Trabajo. */
export function detectLineHeader(row: string[]): string | null {
  for (const cell of row) {
    const trimmed = cell.trim();
    if (!trimmed) continue;
    const fromCell = parseLineFromCell(trimmed);
    if (fromCell) return fromCell;
  }

  const cells = row.map((c) => c.trim()).filter(Boolean);
  if (cells.length === 0 || cells.length > 4) return null;

  const joined = normalizeKey(cells.join(" "));
  const embedded = joined.match(/\blinea\s*(\d+)\b/);
  if (embedded && cells.length <= 2) {
    return `Línea ${embedded[1]}`;
  }

  return null;
}

export function detectBranchOwnerRow(row: string[], tabSector: "ELABORACION" | "ACONDICIONAMIENTO"): string | null {
  if (tabSector !== "ELABORACION") return null;

  const nonEmpty = row
    .map((c, i) => ({ c: c.trim(), i }))
    .filter(({ c }) => c.length > 0);

  if (nonEmpty.length !== 1) return null;

  const label = nonEmpty[0].c;
  const key = normalizeKey(label);
  if (key === "cristian") return normalizePersonName("Cristian");
  if (key === "nicolas") return normalizePersonName("Nicolás");
  return null;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function inferOriginStage(sector: string): "ELABORACION" | "ACONDICIONAMIENTO" {
  return sector === "ELABORACION" ? "ELABORACION" : "ACONDICIONAMIENTO";
}
