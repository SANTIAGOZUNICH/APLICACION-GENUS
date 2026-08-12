import type { AsignacionLoteUpsertInput } from "../adapters/asignacion-lotes-repository";
import { parseNonNegativeNumber } from "./clipboard-import";
import type { ExcelPreviewIssue } from "./excel-import-preview-utils";
import { parseFlexibleDate } from "./delivery-date";

/** Aliases de encabezado (solo títulos). El contenido de celdas no se normaliza aquí. */
export const ASIGNACION_LOTES_FIELD_ALIASES: Record<string, string[]> = {
  lote: ["lote", "n° lote", "nº lote", "nro lote", "batch"],
  fecha: ["fecha", "fecha asignacion", "fecha asignación"],
  producto: ["producto", "nombre producto", "descripcion", "descripción"],
  codigo: ["codigo", "código", "cod.", "cod", "codigo producto", "código producto"],
  marca: ["marca"],
  cantidades: ["cantidad", "cantidades", "cant."],
  vto: ["vto", "vencimiento", "fecha vto", "fecha vencimiento"],
  muestras: ["muestras"],
  cjMuestra: ["cj muestra", "cajas muestra", "cajas de muestra"],
  fechaAnalisis: ["fecha analisis", "fecha análisis"],
  observaciones: ["observaciones", "observacion", "observación", "notas", "comentarios"],
  cliente: ["cliente", "razon social", "razón social"],
};

export interface AsignacionLoteMappedRow {
  lote: string;
  fecha: string;
  producto: string;
  codigo: string;
  marca: string;
  cantidades: string;
  vto: string;
  muestras: string;
  cjMuestra: string;
  fechaAnalisis: string;
  observaciones: string;
  cliente: string;
}

/** Texto de preview cuando el código importado está vacío (no se persiste). */
export function formatAsignacionCodigoPreview(codigo: string | null | undefined): string {
  return codigo?.trim() ? codigo.trim() : "Sin código";
}

/**
 * Código tal como viene de la celda CÓDIGO (trim extremos).
 * Vacío → "". Nunca usa PRODUCTO ni genera valores.
 */
export function normalizeImportedCodigo(raw: string | null | undefined): string {
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Carga flexible (celdas vacías permitidas): ningún campo bloquea la
 * importación de la fila por estar vacío — lote/fecha/producto/cantidades
 * quedan como null/"" igual que código, que ya era opcional. Solo se
 * advierte cuando el dato SÍ está presente pero tiene un formato inválido
 * (fecha/VTO no parseable) o cuando la fila entera está vacía (lo cubre
 * `excel-import-preview-dialog.tsx`'s `emptyIssueCheck`, no acá). La
 * validación de "obligatorio para tal acción" (ej. entregar sin VTO) queda
 * para el momento en que esa acción se ejecuta, no en la carga.
 */
export function validateAsignacionLoteRow(
  row: Partial<AsignacionLoteMappedRow>,
  rowIndex = 1
): ExcelPreviewIssue[] {
  const issues: ExcelPreviewIssue[] = [];

  if (row.fecha?.trim() && !parseFlexibleDate(row.fecha)) {
    issues.push({ rowIndex, field: "fecha", message: "Fecha inválida.", severity: "warning" });
  }

  const vto = row.vto?.trim();
  if (vto && !parseFlexibleDate(vto)) {
    issues.push({ rowIndex, field: "vto", message: "VTO inválido.", severity: "warning" });
  }

  const fechaAnalisis = row.fechaAnalisis?.trim();
  if (fechaAnalisis && !parseFlexibleDate(fechaAnalisis)) {
    issues.push({
      rowIndex,
      field: "fechaAnalisis",
      message: "Fecha análisis inválida.",
      severity: "warning",
    });
  }

  return issues;
}

export function buildAsignacionLoteFromMappedRow(
  row: Partial<AsignacionLoteMappedRow>,
  updatedBy: string
): AsignacionLoteUpsertInput {
  return {
    lote: row.lote?.trim() ?? "",
    fecha: row.fecha?.trim() ? parseFlexibleDate(row.fecha) ?? row.fecha.trim() : null,
    producto: row.producto?.trim() ?? "",
    codigo: normalizeImportedCodigo(row.codigo),
    marca: row.marca?.trim() ?? "",
    cantidades: parseNonNegativeNumber(row.cantidades ?? "") ?? 0,
    vto: row.vto?.trim() ? parseFlexibleDate(row.vto) : null,
    muestras: row.muestras?.trim() ?? "",
    cjMuestra: row.cjMuestra?.trim() ?? "",
    fechaAnalisis: row.fechaAnalisis?.trim() ? parseFlexibleDate(row.fechaAnalisis) : null,
    observaciones: row.observaciones?.trim() ?? "",
    updatedBy,
    createdBy: updatedBy,
  };
}
