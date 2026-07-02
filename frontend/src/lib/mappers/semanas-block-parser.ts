import { pickField } from "@/lib/adapters/sheets/parse-sheet-rows";
import { normalizeSheetLabel } from "@/lib/mappers/sheet-field-resolver";
import { normalizePersonName } from "@/lib/operational/display-fields";
import type { SemanasBlockKind } from "@/types/discovery/semanas-discovery.types";

export interface SemanasBlockSection {
  kind: SemanasBlockKind;
  startRow: number;
  headerRow: number | null;
  endRow: number;
}

/** Contexto visual acumulado mientras se recorre un bloque SEMANAS — F10.1. */
export interface SemanasVisualContext {
  elaborador: string | null;
  lineLabel: string | null;
  packagingTier: "masivo" | "premium" | null;
}

const HEADER_KEYWORDS = [
  "cliente",
  "producto",
  "cantidad",
  "kg",
  "kilos",
  "unidades",
  "oe",
  "oa",
  "pedido",
  "lote",
  "entrega",
  "fecha",
  "observaciones",
  "responsable",
  "elaborador",
  "marca",
  "descripcion",
  "prioridad",
];

const BLOCK_PATTERNS: Array<{ kind: SemanasBlockKind; patterns: string[] }> = [
  { kind: "DESARROLLO", patterns: ["desarrollo", "muestras", "sample"] },
  { kind: "ELABORACION", patterns: ["elaboracion", "elaboración"] },
  { kind: "ACONDICIONAMIENTO", patterns: ["acondicionamiento", "envasado"] },
  { kind: "ENTREGAS", patterns: ["entregas", "entrega", "despacho"] },
];

function rowText(row: string[]): string {
  return row.map((c) => c.trim()).filter(Boolean).join(" ").toLowerCase();
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function detectBlockKind(row: string[]): SemanasBlockKind | null {
  const text = normalizeSheetLabel(rowText(row));
  if (!text) return null;

  for (const { kind, patterns } of BLOCK_PATTERNS) {
    if (patterns.some((p) => text.includes(normalizeSheetLabel(p)))) {
      return kind;
    }
  }

  if (text.includes("premium")) return "ACONDICIONAMIENTO";
  if (text.includes("masivo") || text.includes("consumo")) return "ACONDICIONAMIENTO";

  return null;
}

function looksLikeHeaderRow(row: string[]): boolean {
  const cells = row.map((c) => c.trim()).filter(Boolean);
  if (cells.length < 2) return false;
  const normalized = cells.map((c) => normalizeText(c));
  const headerHits = normalized.filter((c) =>
    HEADER_KEYWORDS.some((kw) => c.includes(kw))
  ).length;
  if (headerHits >= 2) return true;
  const numeric = cells.filter((c) => /^\d+([.,]\d+)?$/.test(c)).length;
  return numeric / cells.length < 0.5 && headerHits >= 1;
}

export function detectSemanasBlocks(rows: string[][]): SemanasBlockSection[] {
  const sections: SemanasBlockSection[] = [];
  let current: SemanasBlockSection | null = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const kind = detectBlockKind(row);

    if (kind) {
      if (current) {
        current.endRow = i;
        sections.push(current);
      }
      current = {
        kind,
        startRow: i + 1,
        headerRow: null,
        endRow: rows.length,
      };
      continue;
    }

    if (current && current.headerRow === null && looksLikeHeaderRow(row)) {
      current.headerRow = i + 1;
    }
  }

  if (current) {
    sections.push(current);
  }

  return sections;
}

export function extractBlockHeaders(rows: string[][], headerRow: number): string[] {
  const row = rows[headerRow - 1] ?? [];
  return row.map((cell) => cell.trim());
}

export function recordFromSemanasRow(
  headers: string[],
  row: string[]
): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    const key = normalizeSheetLabel(header);
    const value = row[index]?.trim();
    if (key && value) {
      record[key] = value;
    }
  });
  return record;
}

export function isMeaningfulSemanasRow(record: Record<string, string>): boolean {
  const values = Object.values(record).filter(Boolean);
  return values.length >= 2;
}

export function inferLineFromRecord(record: Record<string, string>): string | null {
  return (
    pickField(record, "linea", "línea", "line", "sector_linea") ||
    pickField(record, "envasado", "tipo_linea") ||
    null
  );
}

/** Detecta fila de elaborador (bloque visual): CRISTIAN, NICOLÁS, etc. */
export function detectElaboradorLabel(row: string[]): string | null {
  const cells = row.map((c) => c.trim()).filter(Boolean);
  if (cells.length === 0 || cells.length > 3) return null;

  const primary = cells[0];
  const normalized = normalizeText(primary);

  if (HEADER_KEYWORDS.some((kw) => normalized.includes(kw))) return null;
  if (detectBlockKind(row)) return null;
  if (detectLineLabel(row)) return null;
  if (/^\d+([.,]\d+)?$/.test(primary)) return null;
  if (primary.length < 2 || primary.length > 40) return null;
  if (!/^[A-Za-zÁÉÍÓÚÑáéíóúñ\s.'-]+$/.test(primary)) return null;

  const mostlyEmptyRest = row.slice(1).filter((c) => c.trim()).length <= 1;
  if (!mostlyEmptyRest && cells.length > 1) {
    const allShort = cells.every((c) => c.length < 20);
    if (!allShort) return null;
  }

  return normalizePersonName(primary);
}

/** Detecta fila de línea: LÍNEA 1, LINEA 2, PREMIUM A, etc. */
export function detectLineLabel(row: string[]): string | null {
  const text = row.map((c) => c.trim()).filter(Boolean).join(" ");
  if (!text) return null;

  const normalized = normalizeText(text);

  const lineMatch = normalized.match(/linea\s*([123abc])/i);
  if (lineMatch) {
    const num = lineMatch[1];
    if (/[123]/.test(num)) {
      return `LÍNEA ${num}`;
    }
    return `PREMIUM ${num.toUpperCase()}`;
  }

  if (/^linea\s*[123]$/i.test(text.trim())) {
    const n = text.replace(/\D/g, "");
    return `LÍNEA ${n}`;
  }

  const premiumMatch = normalized.match(/premium\s*([ab])?/i);
  if (premiumMatch) {
    const letter = premiumMatch[1]?.toUpperCase() ?? "";
    return letter ? `PREMIUM ${letter}` : "PREMIUM";
  }

  if (normalized === "l1" || normalized === "l2" || normalized === "l3") {
    return `LÍNEA ${normalized.slice(1)}`;
  }

  return null;
}

/** Detecta sub-sección Masivo vs Premium dentro de Acondicionamiento. */
export function detectPackagingTier(row: string[]): "masivo" | "premium" | null {
  const text = normalizeText(rowText(row));
  if (!text) return null;
  if (text.includes("premium")) return "premium";
  if (text.includes("masivo") || text.includes("consumo")) return "masivo";
  return null;
}

export function createVisualContext(): SemanasVisualContext {
  return { elaborador: null, lineLabel: null, packagingTier: null };
}

export function inferPriorityFromRecord(record: Record<string, string>): string | null {
  return pickField(record, "prioridad", "urgencia", "priority") || null;
}

export function mapPriorityLabel(
  raw: string | null
): import("@/types/operational/work-item").WorkItemPriority | null {
  if (!raw?.trim()) return null;
  const n = normalizeText(raw);
  if (n.includes("urgent")) return "URGENTE";
  if (n === "hoy") return "HOY";
  if (n.includes("semana")) return "ESTA_SEMANA";
  if (n.includes("baja")) return "BAJA";
  if (n.includes("normal")) return "NORMAL";
  return null;
}

export function summarizeBlocks(
  sections: SemanasBlockSection[]
): Record<SemanasBlockKind, number> {
  const summary: Record<SemanasBlockKind, number> = {
    ELABORACION: 0,
    ACONDICIONAMIENTO: 0,
    ENTREGAS: 0,
    DESARROLLO: 0,
    OTRO: 0,
  };
  for (const section of sections) {
    summary[section.kind] += 1;
  }
  return summary;
}

/** Normaliza etiqueta de línea para WorkItem.line */
export function normalizeLineLabel(label: string | null): string | null {
  if (!label) return null;
  return detectLineLabel([label]) ?? label.trim();
}
