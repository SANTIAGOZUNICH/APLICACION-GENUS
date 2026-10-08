/**
 * Edición por celda de Asignación de Lotes — reglas compartidas cliente/servidor.
 *
 * Módulo PURO (sin server-only, sin DB): lo importan la grilla (validación
 * inmediata + preview de pegado) y el servicio (validación autoritativa).
 * El servidor NUNCA confía en lo que validó el cliente — vuelve a correr
 * exactamente estas funciones.
 *
 * Política de edición (ver docss/38-grilla-excel-asignacion-lotes.md):
 * - Registro SINCRONIZADO desde Google Sheets (sourceId != null): TODAS las
 *   columnas de contenido son de solo lectura. Google es la única fuente de
 *   verdad; el próximo sync pisaría cualquier edición local, así que no se
 *   permite crear esa segunda fuente oculta. Se corrige en la Sheet.
 * - Registro manual / "Pegar desde Excel" (sourceId == null): editable por
 *   celda, según el sector (matriz CELL_EDIT_SECTORS).
 */
import { parseFlexibleDate } from "@/features/os/operational/lib/delivery-date";
import { parseNonNegativeNumber } from "@/features/os/operational/lib/clipboard-import";
import type { SectorId } from "@/types/operational/sector";

export const ASIGNACION_CELL_FIELDS = [
  "lote",
  "fecha",
  "producto",
  "codigo",
  "marca",
  "cantidades",
  "vto",
  "muestras",
  "cjMuestra",
  "fechaAnalisis",
  "observaciones",
] as const;

export type AsignacionCellField = (typeof ASIGNACION_CELL_FIELDS)[number];

export type AsignacionCellKind = "text" | "number" | "date";

export const ASIGNACION_CELL_KIND: Record<AsignacionCellField, AsignacionCellKind> = {
  lote: "text",
  fecha: "date",
  producto: "text",
  codigo: "text",
  marca: "text",
  cantidades: "number",
  vto: "date",
  muestras: "text",
  cjMuestra: "text",
  fechaAnalisis: "date",
  observaciones: "text",
};

/** Campos que identifican el registro: no pueden quedar vacíos. */
const REQUIRED_FIELDS: ReadonlySet<AsignacionCellField> = new Set(["lote", "producto"]);

/** Campos que forman la identidad (lote, código, producto) — requieren chequeo de duplicado. */
export const IDENTITY_FIELDS: ReadonlySet<AsignacionCellField> = new Set(["lote", "codigo", "producto"]);

const MAX_LEN: Partial<Record<AsignacionCellField, number>> = { observaciones: 2000 };
const DEFAULT_MAX_LEN = 300;

/** Qué sectores pueden editar cada campo (el sector ya tiene acceso al módulo). */
export const CELL_EDIT_SECTORS: Record<AsignacionCellField, ReadonlySet<SectorId>> = {
  lote: new Set<SectorId>(["CALIDAD", "PRODUCCION"]),
  fecha: new Set<SectorId>(["CALIDAD", "PRODUCCION"]),
  producto: new Set<SectorId>(["CALIDAD", "PRODUCCION"]),
  codigo: new Set<SectorId>(["CALIDAD", "PRODUCCION"]),
  marca: new Set<SectorId>(["CALIDAD", "PRODUCCION"]),
  cantidades: new Set<SectorId>(["CALIDAD", "PRODUCCION"]),
  vto: new Set<SectorId>(["CALIDAD", "PRODUCCION"]),
  // Campos propios de Calidad (muestras / análisis).
  muestras: new Set<SectorId>(["CALIDAD"]),
  cjMuestra: new Set<SectorId>(["CALIDAD"]),
  fechaAnalisis: new Set<SectorId>(["CALIDAD"]),
  observaciones: new Set<SectorId>(["CALIDAD", "PRODUCCION", "CODIFICADO"]),
};

export function isAsignacionCellField(value: unknown): value is AsignacionCellField {
  return typeof value === "string" && (ASIGNACION_CELL_FIELDS as readonly string[]).includes(value);
}

export function canEditAsignacionCellField(
  sector: SectorId | null | undefined,
  field: AsignacionCellField
): boolean {
  return Boolean(sector && CELL_EDIT_SECTORS[field].has(sector));
}

/** Motivo por el que una celda NO es editable (null = editable). Usado por la UI y por el servidor. */
export function cellProtectionReason(
  record: { sourceId?: string | null; archived?: boolean },
  field: AsignacionCellField,
  sector: SectorId | null | undefined
): string | null {
  if (record.archived) return "Registro archivado: restauralo para editarlo.";
  if (record.sourceId) {
    return "Registro sincronizado desde Google Sheets (fuente de verdad). Corregilo en la Sheet — el próximo sync pisaría cualquier cambio local.";
  }
  if (!canEditAsignacionCellField(sector, field)) {
    return "Tu sector no puede editar esta columna.";
  }
  return null;
}

export type CellValidation =
  | { ok: true; value: string | number | null }
  | { ok: false; message: string };

function validDate(iso: string): boolean {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1990 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * Valida y normaliza el valor que escribió/pegó el usuario (siempre string,
 * tal como viene del input o del portapapeles de Excel/Sheets).
 * - text: trim, largo máximo, obligatorio para lote/producto.
 * - number: formato es-AR (1.234,5) o plano; >= 0.
 * - date: dd/mm/aaaa, aaaa-mm-dd, etc. → ISO; vacío = null; fecha real.
 */
export function validateCellValue(field: AsignacionCellField, raw: unknown): CellValidation {
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  const kind = ASIGNACION_CELL_KIND[field];

  if (kind === "text") {
    if (!text && REQUIRED_FIELDS.has(field)) {
      return { ok: false, message: "Este campo es obligatorio y no puede quedar vacío." };
    }
    const max = MAX_LEN[field] ?? DEFAULT_MAX_LEN;
    if (text.length > max) return { ok: false, message: `Máximo ${max} caracteres.` };
    return { ok: true, value: text };
  }

  if (kind === "number") {
    if (!text) return { ok: false, message: "Ingresá una cantidad (número ≥ 0)." };
    const n = parseNonNegativeNumber(text);
    if (n === null) return { ok: false, message: "Cantidad inválida: debe ser un número mayor o igual a 0." };
    if (n > 1_000_000_000) return { ok: false, message: "Cantidad fuera de rango." };
    return { ok: true, value: n };
  }

  if (!text) return { ok: true, value: null };
  const iso = parseFlexibleDate(text);
  if (!iso || !validDate(iso)) {
    return { ok: false, message: "Fecha inválida. Usá dd/mm/aaaa." };
  }
  return { ok: true, value: iso };
}

/** Cambio de UNA celda — nunca lleva el resto del registro. */
export interface AsignacionCellChange {
  id: string;
  field: AsignacionCellField;
  /** Valor crudo tal como lo escribió/pegó el usuario. */
  value: string;
  /** `updatedAt` del registro que el cliente tenía al editar (control de concurrencia). */
  expectedVersion: string;
}

export type AsignacionCellFailureCode =
  | "NOT_FOUND"
  | "PROTECTED_SOURCE"
  | "FORBIDDEN_FIELD"
  | "INVALID_FIELD"
  | "INVALID_VALUE"
  | "DUPLICATE"
  | "CONFLICT"
  | "ARCHIVED";

export interface AsignacionCellFailure {
  index: number;
  id: string;
  field: string;
  code: AsignacionCellFailureCode;
  message: string;
}

/** Tope por request: un pegado masivo razonable, nunca una importación encubierta. */
export const MAX_CELL_CHANGES_PER_REQUEST = 2000;
