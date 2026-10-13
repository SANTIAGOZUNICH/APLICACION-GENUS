/**
 * Reglas PURAS para elegir la fórmula de un trabajo asignado (OE automática). Nunca se elige por parecido:
 *  - una sola coincidencia EXACTA (cliente + producto normalizados) o no se elige;
 *  - una fórmula sin materias primas, con algún % vacío o con un total fuera de 98–102 % es «incompleta»: no se usa.
 */
import { normalizeSearchKey } from "./types";

export type WorkFormulaMaterial = { materiaPrima: string; codigo: string; formulaPct: number | null };

export type WorkFormulaRef = {
  source: "CACHE_NEON" | "DRIVE";
  /** Ids del banco (uuid) o sintéticos de Drive («drive:…»). */
  formulaProductId: string;
  formulaVersionId: string;
  versionHash: string;
  displayClient?: string;
  displayProduct?: string;
  productCode?: string;
  driveFileId?: string;
  driveModifiedTime?: string | null;
  sourceSheet?: string;
};

export type WorkFormulaResolution =
  | {
      ok: true;
      ref: WorkFormulaRef;
      materials: WorkFormulaMaterial[];
      procedureSteps: Array<{ id: string; text: string }>;
    }
  | {
      ok: false;
      status: "not_found" | "ambiguous" | "conflict" | "incomplete" | "error" | "missing_input";
      message: string;
    };

/** Entre los archivos de Drive del cliente, el ÚNICO cuyo producto coincide exacto (sin aproximaciones). */
export function pickExactDriveHit<T extends { productLabel: string; aliases?: string[] }>(
  hits: T[],
  product: string
): { kind: "one"; hit: T } | { kind: "none" } | { kind: "many"; count: number; hits: T[] } {
  const target = normalizeSearchKey(product);
  if (!target) return { kind: "none" };
  const exact = hits.filter(
    (h) => normalizeSearchKey(h.productLabel) === target || (h.aliases ?? []).some((a) => normalizeSearchKey(a) === target)
  );
  if (exact.length === 1) return { kind: "one", hit: exact[0]! };
  if (exact.length === 0) return { kind: "none" };
  return { kind: "many", count: exact.length, hits: exact };
}

/**
 * Mismo cliente + producto en más de una CARPETA de fórmulas (principal y adicional):
 *  - mismo contenido (mismo checksum) → no es conflicto: se usa el de la carpeta principal (o el primero);
 *  - contenido distinto → conflicto: no se elige ninguno.
 * Si todos los archivos son de la misma carpeta, no aplica (es la ambigüedad de siempre).
 */
export function resolveCrossSourceDuplicates<T extends { sourceFolderId?: string; primarySource?: boolean }>(
  hits: T[],
  checksums: string[]
): { kind: "same_folder" } | { kind: "identical"; hit: T } | { kind: "conflict" } {
  const folders = new Set(hits.map((h) => h.sourceFolderId ?? ""));
  if (folders.size <= 1) return { kind: "same_folder" };
  if (checksums.length === hits.length && new Set(checksums).size === 1) {
    return { kind: "identical", hit: hits.find((h) => h.primarySource) ?? hits[0]! };
  }
  return { kind: "conflict" };
}

/** null = completa; si no, por qué no se puede usar. */
export function formulaIncompleteReason(materials: WorkFormulaMaterial[]): string | null {
  const rows = materials.filter((m) => (m.materiaPrima ?? "").trim() || (m.codigo ?? "").trim());
  if (rows.length === 0) return "La fórmula no tiene materias primas.";
  const sinPct = rows.filter((m) => m.formulaPct == null || !Number.isFinite(m.formulaPct));
  if (sinPct.length) return `La fórmula tiene materias primas sin porcentaje (${sinPct.map((m) => m.materiaPrima || m.codigo).join(", ")}).`;
  const total = rows.reduce((s, m) => s + (m.formulaPct ?? 0), 0);
  if (total < 98 || total > 102) return `Los porcentajes de la fórmula suman ${Math.round(total * 100) / 100} % (se espera 100 %).`;
  return null;
}
