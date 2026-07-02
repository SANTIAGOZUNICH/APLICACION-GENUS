import { normalizeSheetLabel } from "@/lib/mappers/sheet-field-resolver";
import { pickField } from "@/lib/adapters/sheets/parse-sheet-rows";
import type { SemanasBlockKind } from "@/types/discovery/semanas-discovery.types";

export interface SemanasBlockSection {
  kind: SemanasBlockKind;
  startRow: number;
  headerRow: number | null;
  endRow: number;
}

const BLOCK_PATTERNS: Array<{ kind: SemanasBlockKind; patterns: string[] }> = [
  {
    kind: "DESARROLLO",
    patterns: ["desarrollo", "muestras", "sample"],
  },
  {
    kind: "ELABORACION",
    patterns: ["elaboracion", "elaboración"],
  },
  {
    kind: "ACONDICIONAMIENTO",
    patterns: ["acondicionamiento", "envasado"],
  },
  {
    kind: "ENTREGAS",
    patterns: ["entregas", "entrega", "despacho"],
  },
];

function rowText(row: string[]): string {
  return row.map((c) => c.trim()).filter(Boolean).join(" ").toLowerCase();
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
  const numeric = cells.filter((c) => /^\d+([.,]\d+)?$/.test(c)).length;
  return numeric / cells.length < 0.5;
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

export function inferPriorityFromRecord(
  record: Record<string, string>
): string | null {
  return pickField(record, "prioridad", "urgencia", "priority") || null;
}

export function mapPriorityLabel(raw: string | null): import("@/types/operational/work-item").WorkItemPriority | null {
  if (!raw?.trim()) return null;
  const n = normalizeSheetLabel(raw);
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
