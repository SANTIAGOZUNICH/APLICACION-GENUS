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
      /** Causa concreta (solo la que se pudo determinar), para que la OE explique por qué no hay fórmula. */
      cause?: FormulaMissCause;
    };

/**
 * Por qué una OE no encontró su fórmula. Solo causas que se pueden comprobar; si no se pudo consultar Drive, se dice
 * eso (no se supone que la fórmula no existe).
 */
export type FormulaMissCause =
  | "SIN_DATOS"
  | "BANCO_NO_DISPONIBLE"
  | "BANCO_CONFLICTO"
  | "BANCO_AMBIGUA"
  | "BANCO_INCOMPLETA"
  | "DRIVE_SIN_CONFIGURAR"
  | "DRIVE_SIN_ACCESO"
  | "DRIVE_ERROR"
  | "NO_EN_BANCO_SIN_CARPETA_CLIENTE"
  | "NO_EN_BANCO_SIN_ARCHIVO"
  | "DRIVE_AMBIGUA"
  | "DRIVE_ILEGIBLE"
  | "DRIVE_INCOMPLETA";

export const FORMULA_MISS_CAUSE_LABEL: Record<FormulaMissCause, string> = {
  SIN_DATOS: "Faltan datos del trabajo",
  BANCO_NO_DISPONIBLE: "No se pudo consultar el banco de fórmulas",
  BANCO_CONFLICTO: "Conflicto de versiones en el banco",
  BANCO_AMBIGUA: "Más de una fórmula coincide en el banco",
  BANCO_INCOMPLETA: "Fórmula incompleta en el banco",
  DRIVE_SIN_CONFIGURAR: "No está en el banco y Google Drive no está configurado",
  DRIVE_SIN_ACCESO: "No está en el banco y no se pudo acceder a Google Drive",
  DRIVE_ERROR: "No está en el banco y falló la lectura de Google Drive",
  NO_EN_BANCO_SIN_CARPETA_CLIENTE: "No está en el banco ni hay carpeta del cliente en Drive",
  NO_EN_BANCO_SIN_ARCHIVO: "No está en el banco ni en la carpeta del cliente en Drive",
  DRIVE_AMBIGUA: "Más de un archivo coincide en Drive",
  DRIVE_ILEGIBLE: "El archivo de Drive no se pudo leer como fórmula",
  DRIVE_INCOMPLETA: "Fórmula incompleta en Drive",
};

/** Entre los archivos de Drive del cliente, el ÚNICO cuyo producto coincide exacto (sin aproximaciones). */
export function pickExactDriveHit<T extends { productLabel: string; aliases?: string[] }>(
  hits: T[],
  product: string
): { kind: "one"; hit: T } | { kind: "none" } | { kind: "many"; count: number } {
  const target = normalizeSearchKey(product);
  if (!target) return { kind: "none" };
  const exact = hits.filter(
    (h) => normalizeSearchKey(h.productLabel) === target || (h.aliases ?? []).some((a) => normalizeSearchKey(a) === target)
  );
  if (exact.length === 1) return { kind: "one", hit: exact[0]! };
  if (exact.length === 0) return { kind: "none" };
  return { kind: "many", count: exact.length };
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
