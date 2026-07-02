import { pickField } from "@/lib/adapters/sheets/parse-sheet-rows";
import { Status } from "@/types/ui/status";

/**
 * Normalizes sheet labels/headers for alias lookup.
 * Handles accents, spaces, and punctuation differences across Genus spreadsheets.
 */
export function normalizeSheetLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/** Scan label/value pairs (column A = label, column B = value). */
export function extractLabelValuePairs(rows: string[][]): Record<string, string> {
  const pairs: Record<string, string> = {};

  for (const row of rows.slice(0, 80)) {
    if (row.length < 2) continue;
    const label = row[0]?.trim();
    const value = row[1]?.trim();
    if (!label || !value) continue;
    pairs[normalizeSheetLabel(label)] = value;
  }

  return pairs;
}

export function mergeFieldSources(
  ...sources: Record<string, string>[]
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (value.trim()) {
        merged[key] = value.trim();
      }
    }
  }
  return merged;
}

export { pickField };

export function inferOeStatus(value: string): Status {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("cerr")) return Status.CERRADA;
  if (normalized.includes("bloq")) return Status.BLOQUEADO;
  if (normalized.includes("curso")) return Status.EN_CURSO;
  if (normalized.includes("planif")) return Status.PLANIFICADA;
  if (normalized.includes("liber")) return Status.LIBERADO;
  return Status.EN_CURSO;
}

export function inferOaStatus(value: string): Status {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("cerr")) return Status.CERRADA;
  if (normalized.includes("bloq")) return Status.BLOQUEADO;
  if (normalized.includes("curso")) return Status.EN_CURSO;
  if (normalized.includes("planif")) return Status.PLANIFICADA;
  return Status.EN_CURSO;
}

export function inferPedidoStatus(value: string): Status {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("compl")) return Status.COMPLETO;
  if (normalized.includes("parcial")) return Status.PARCIAL;
  if (normalized.includes("pend")) return Status.PENDIENTE;
  if (normalized.includes("crit")) return Status.CRITICO;
  return Status.PENDIENTE;
}

export function inferLiberacionStatus(value: string): Status {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("liber")) return Status.LIBERADO;
  if (normalized.includes("rechaz")) return Status.RECHAZADO;
  if (normalized.includes("borrador") || normalized.includes("revision")) {
    return Status.BORRADOR_EN_REVISION;
  }
  if (normalized.includes("bloq")) return Status.BLOQUEADO;
  if (normalized.includes("cuarentena")) return Status.CUARENTENA;
  return Status.CUARENTENA;
}

export function isLiberacionCandidate(estado: string): boolean {
  const normalized = estado.trim().toLowerCase();
  return (
    normalized.includes("cuarentena") ||
    normalized.includes("revision") ||
    normalized.includes("liberacion") ||
    normalized.includes("liber") ||
    normalized.includes("calidad") ||
    normalized.includes("analisis") ||
    normalized.includes("bloq")
  );
}

export function liberacionIdFromLote(loteId: string): string {
  const normalized = loteId.trim();
  if (normalized.toUpperCase().startsWith("LIB-")) {
    return normalized;
  }
  return `LIB-${normalized}`;
}

export function loteIdFromLiberacion(lookupKey: string): string {
  const normalized = lookupKey.trim();
  if (normalized.toUpperCase().startsWith("LIB-")) {
    return normalized.slice(4);
  }
  return normalized;
}
