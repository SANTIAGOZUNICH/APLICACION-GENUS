import type { AsignacionLoteUpsertInput } from "../adapters/asignacion-lotes-repository";
import {
  parseNonNegativeNumber,
  type RowValidationIssue,
} from "./clipboard-import";
import { parseFlexibleDate } from "./delivery-date";

export const ASIGNACION_LOTES_FIELD_ALIASES: Record<string, string[]> = {
  lote: ["lote", "nro lote", "n° lote", "batch"],
  fecha: ["fecha", "fecha asignacion", "fecha asignación", "fecha lote"],
  producto: ["producto", "descripcion", "descripción", "nombre producto", "cream", "creamy"],
  codigo: ["codigo", "código", "cod", "codigo producto", "código producto", "sku"],
  marca: ["marca", "brand"],
  cantidades: ["cantidades", "cantidad", "unidades", "kg", "qty"],
  vto: ["vto", "vencimiento", "fecha vencimiento", "vence"],
  muestras: ["muestras", "muestra", "sample"],
  cjMuestra: ["cj muestra", "cj. muestra", "caja muestra", "cajas muestra"],
  fechaAnalisis: ["fecha analisis", "fecha análisis", "analisis", "análisis"],
  observaciones: ["observaciones", "observacion", "observación", "notas", "comentarios"],
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
}

export function validateAsignacionLoteRow(
  row: Partial<AsignacionLoteMappedRow>,
  rowIndex = 1
): RowValidationIssue[] {
  const issues: RowValidationIssue[] = [];
  const cantidades = parseNonNegativeNumber(row.cantidades ?? "");

  if (!row.lote?.trim()) issues.push({ rowIndex, field: "lote", message: "Lote obligatorio." });
  if (!row.fecha?.trim()) issues.push({ rowIndex, field: "fecha", message: "Fecha obligatoria." });
  if (row.fecha?.trim() && !parseFlexibleDate(row.fecha)) {
    issues.push({ rowIndex, field: "fecha", message: "Fecha inválida." });
  }
  if (!row.producto?.trim()) {
    issues.push({ rowIndex, field: "producto", message: "Producto obligatorio." });
  }
  if (!row.codigo?.trim()) issues.push({ rowIndex, field: "codigo", message: "Código obligatorio." });
  if (cantidades === null) {
    issues.push({
      rowIndex,
      field: "cantidades",
      message: "Cantidades obligatoria, numérica y mayor o igual a 0.",
    });
  }

  const vto = row.vto?.trim();
  if (vto && !parseFlexibleDate(vto)) {
    issues.push({ rowIndex, field: "vto", message: "VTO inválido." });
  }

  const fechaAnalisis = row.fechaAnalisis?.trim();
  if (fechaAnalisis && !parseFlexibleDate(fechaAnalisis)) {
    issues.push({ rowIndex, field: "fechaAnalisis", message: "Fecha análisis inválida." });
  }

  return issues;
}

export function buildAsignacionLoteFromMappedRow(
  row: Partial<AsignacionLoteMappedRow>,
  updatedBy: string
): AsignacionLoteUpsertInput {
  return {
    lote: row.lote?.trim() ?? "",
    fecha: row.fecha?.trim() ? parseFlexibleDate(row.fecha) ?? row.fecha.trim() : "",
    producto: row.producto?.trim() ?? "",
    codigo: row.codigo?.trim() ?? "",
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
