import type { MateriaPrimaUpsertInput, MateriaPrimaEstadoManual } from "../adapters/materia-prima-repository";
import {
  parseNonNegativeNumber,
  type RowValidationIssue,
} from "./clipboard-import";
import { parseFlexibleDate } from "./delivery-date";

export const MP_FIELD_ALIASES: Record<string, string[]> = {
  codigo: ["codigo", "código", "cod", "codigo mp", "código mp", "sku"],
  nombre: ["nombre", "materia prima", "materia", "descripcion", "descripción", "insumo"],
  lote: ["lote", "batch", "partida"],
  proveedor: ["proveedor", "supplier"],
  cantidad: ["cantidad", "stock", "saldo", "existencia", "kg", "unidades"],
  unidad: ["unidad", "uom", "um", "medida"],
  fechaIngreso: ["fecha ingreso", "ingreso", "fecha de ingreso", "recepcion", "recepción"],
  vencimiento: ["vencimiento", "fecha vencimiento", "fecha de vencimiento", "vto", "vence"],
  ubicacion: ["ubicacion", "ubicación", "deposito", "depósito", "rack", "sector"],
  estadoManual: ["estado", "estado manual", "disponibilidad"],
  observaciones: ["observaciones", "observacion", "observación", "notas", "comentarios"],
};

export interface MateriaPrimaMappedRow {
  codigo: string;
  nombre: string;
  lote: string;
  proveedor: string;
  cantidad: string;
  unidad: string;
  fechaIngreso: string;
  vencimiento: string;
  ubicacion: string;
  estadoManual: string;
  observaciones: string;
}

function normalizeEstadoManual(raw: string): MateriaPrimaEstadoManual | null {
  const value = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
  if (!value || value === "auto" || value === "automatico") return null;
  if (value === "disponible") return "disponible";
  if (value === "por_vencer" || value === "por_vencer_") return "por_vencer";
  if (value === "vencido") return "vencido";
  if (value === "agotado") return "agotado";
  return null;
}

export function validateMpRow(
  row: Partial<MateriaPrimaMappedRow>,
  rowIndex = 1
): RowValidationIssue[] {
  const issues: RowValidationIssue[] = [];
  const cantidad = parseNonNegativeNumber(row.cantidad ?? "");

  if (!row.codigo?.trim()) issues.push({ rowIndex, field: "codigo", message: "Código obligatorio." });
  if (!row.nombre?.trim()) issues.push({ rowIndex, field: "nombre", message: "Nombre obligatorio." });
  if (!row.lote?.trim()) issues.push({ rowIndex, field: "lote", message: "Lote obligatorio." });
  if (cantidad === null) {
    issues.push({
      rowIndex,
      field: "cantidad",
      message: "Cantidad obligatoria, numérica y mayor o igual a 0.",
    });
  }
  if (!row.unidad?.trim()) issues.push({ rowIndex, field: "unidad", message: "Unidad obligatoria." });

  const fechaIngreso = row.fechaIngreso?.trim();
  if (fechaIngreso && !parseFlexibleDate(fechaIngreso)) {
    issues.push({ rowIndex, field: "fechaIngreso", message: "Fecha ingreso inválida." });
  }

  const vencimiento = row.vencimiento?.trim();
  if (vencimiento && !parseFlexibleDate(vencimiento)) {
    issues.push({ rowIndex, field: "vencimiento", message: "Fecha vencimiento inválida." });
  }

  const estado = row.estadoManual?.trim();
  if (estado && normalizeEstadoManual(estado) === null && !/^auto(m[aá]tico)?$/i.test(estado)) {
    issues.push({
      rowIndex,
      field: "estadoManual",
      message: "Estado debe ser Auto, Disponible, Por vencer, Vencido o Agotado.",
    });
  }

  return issues;
}

export function buildMpFromMappedRow(row: Partial<MateriaPrimaMappedRow>): MateriaPrimaUpsertInput {
  const cantidad = parseNonNegativeNumber(row.cantidad ?? "") ?? 0;
  return {
    codigo: row.codigo?.trim() ?? "",
    nombre: row.nombre?.trim() ?? "",
    lote: row.lote?.trim() ?? "",
    proveedor: row.proveedor?.trim() ?? "",
    cantidad,
    stock: cantidad,
    unidad: row.unidad?.trim() || "kg",
    fechaIngreso: row.fechaIngreso?.trim() ? parseFlexibleDate(row.fechaIngreso) : null,
    vencimiento: row.vencimiento?.trim() ? parseFlexibleDate(row.vencimiento) : null,
    ubicacion: row.ubicacion?.trim() ?? "",
    estadoManual: normalizeEstadoManual(row.estadoManual ?? ""),
    observaciones: row.observaciones?.trim() ?? "",
  };
}
