/**
 * Planillas editables de Materias Primas (Etapa 3) — política PURA compartida cliente/servidor.
 *
 *  - Ingresos MP: se editan los datos del documento. TOTAL = bultos × cantidad (calculado). Anulados: solo lectura.
 *    En un ingreso CONFIRMADO, cambiar código, bultos, cantidad o lote mueve el stock: es una CORRECCIÓN y pide
 *    motivo; se aplica como delta (lote de Stock MP y libro mayor en la misma transacción).
 *  - Compras MP: se editan todas las columnas con control de versión. Una compra cancelada solo cambia estado y nota.
 *  - Stock MP: reglas en `cell-edit.ts` (los kg se corrigen con motivo y quedan como ajuste en el libro mayor).
 */
import { parseFlexibleDate } from "@/features/os/operational/lib/delivery-date";
import { parseNonNegativeNumber } from "@/features/os/operational/lib/clipboard-import";
import type { SectorId } from "@/types/operational/sector";
import { canWriteInventory } from "./rbac";

export type MpSheetResource = "mp_ingresos" | "mp_compras";

export const MP_INGRESO_SHEET_FIELDS = [
  "fecha",
  "proveedor",
  "cliente",
  "remitoNro",
  "pccMeNro",
  "codigo",
  "producto",
  "descripcion",
  "bultos",
  "cantidad",
  "ubicacion",
  "lote",
  "vencimiento",
] as const;
export const MP_COMPRA_SHEET_FIELDS = [
  "fecha",
  "materiaPrima",
  "cantidad",
  "unidad",
  "proveedor",
  "fechaEntrega",
  "produccionesAfecta",
  "estado",
  "nota",
] as const;

export const MP_COMPRA_ESTADOS = [
  "",
  "Pendiente de definir",
  "Solicitada",
  "Cotizando",
  "Comprada",
  "En camino",
  "Entrega demorada",
  "En planta",
  "Aporta cliente",
  "Cancelada",
] as const;

const FIELDS: Record<MpSheetResource, readonly string[]> = {
  mp_ingresos: MP_INGRESO_SHEET_FIELDS,
  mp_compras: MP_COMPRA_SHEET_FIELDS,
};
const NUMBER_FIELDS = new Set(["bultos", "cantidad"]);
const DATE_FIELDS = new Set(["fecha", "vencimiento", "fechaEntrega"]);
/** En un ingreso confirmado, estos campos mueven el stock: corrección con motivo. */
export const MP_INGRESO_STOCK_FIELDS: ReadonlySet<string> = new Set(["codigo", "bultos", "cantidad", "lote"]);
export const MIN_MP_CORRECCION_MOTIVO = 8;
export const MAX_MP_SHEET_CHANGES = 200;

export function mpSheetFieldKind(field: string): "text" | "number" | "date" {
  return NUMBER_FIELDS.has(field) ? "number" : DATE_FIELDS.has(field) ? "date" : "text";
}
export function isMpSheetField(resource: MpSheetResource, field: unknown): field is string {
  return typeof field === "string" && FIELDS[resource].includes(field);
}

type ProtectableRow = { status?: string; estado?: string };

/** Motivo por el que la celda NO se edita (null = editable). */
export function mpSheetProtection(
  resource: MpSheetResource,
  row: ProtectableRow,
  field: string,
  sector: SectorId | string | null | undefined,
  isSuperadmin = false
): string | null {
  if (!isMpSheetField(resource, field)) return "Columna calculada: no se edita.";
  if (!isSuperadmin && !canWriteInventory(sector as SectorId, resource)) {
    return "Solo Materia Prima edita esta planilla.";
  }
  if (resource === "mp_ingresos" && row.status === "ANULADO") return "Ingreso anulado: no se edita (conserva el historial).";
  if (resource === "mp_compras" && String(row.estado ?? "").toLowerCase() === "cancelada" && field !== "estado" && field !== "nota") {
    return "Compra cancelada: solo se cambia el estado o la nota.";
  }
  return null;
}

/** ¿Este cambio necesita motivo? (corrección de un ingreso confirmado que mueve stock). */
export function mpSheetNeedsReason(resource: MpSheetResource, row: ProtectableRow, field: string): boolean {
  return resource === "mp_ingresos" && row.status === "CONFIRMADO" && MP_INGRESO_STOCK_FIELDS.has(field);
}

export type MpSheetValidation = { ok: true; value: string | number | null } | { ok: false; message: string };

export function validateMpSheetValue(resource: MpSheetResource, field: string, raw: unknown): MpSheetValidation {
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (NUMBER_FIELDS.has(field)) {
    if (!text) return { ok: true, value: null };
    const n = parseNonNegativeNumber(text);
    if (n === null || n > 1_000_000_000) return { ok: false, message: "Número inválido (≥ 0)." };
    return { ok: true, value: n };
  }
  if (DATE_FIELDS.has(field)) {
    if (!text) return field === "fecha" ? { ok: false, message: "La fecha es obligatoria." } : { ok: true, value: "" };
    const iso = parseFlexibleDate(text);
    if (!iso) return { ok: false, message: "Fecha inválida. Usá dd/mm/aaaa." };
    return { ok: true, value: iso };
  }
  if (resource === "mp_compras" && field === "estado") {
    const match = MP_COMPRA_ESTADOS.find((e) => e.toLowerCase() === text.toLowerCase());
    if (match === undefined) return { ok: false, message: `Estado inválido. Opciones: ${MP_COMPRA_ESTADOS.filter(Boolean).join(", ")}.` };
    return { ok: true, value: match };
  }
  const max = field === "nota" || field === "produccionesAfecta" ? 1000 : 200;
  if (text.length > max) return { ok: false, message: `Máximo ${max} caracteres.` };
  if (resource === "mp_compras" && field === "materiaPrima" && !text) return { ok: false, message: "La materia prima no puede quedar vacía." };
  return { ok: true, value: text };
}

export interface MpSheetChange {
  id: string;
  field: string;
  value: string;
  expectedVersion: string;
  reason?: string;
}
export type MpSheetResult =
  | { ok: true }
  | { ok: false; code: "NOT_FOUND" | "PROTECTED" | "INVALID" | "CONFLICT" | "DUPLICATE"; message: string };
