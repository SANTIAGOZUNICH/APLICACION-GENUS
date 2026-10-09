/**
 * Edición por celda de trabajos (WorkItem) — política PURA compartida cliente/servidor.
 *
 * No hay una segunda ruta de escritura: el servidor aplica cada celda con las funciones CANÓNICAS
 * (`updateWorkItemPlanningDurable`, `updateWorkItemLoteVtoDurable`) que ya cuidan versión
 * (concurrencia optimista), identidad OA/OE y auditoría en `operational_events`.
 * La cantidad realizada (`finishedQty`) solo se CORRIGE (motivo obligatorio, `correctFinishedQtyDurable`): no es un
 * avance. Quedan SIEMPRE fuera de la edición por celda: estado, packingGroups/unidades, decisiones/firmas de Calidad,
 * cierres, entregas y Codificado.
 */
import { parseFlexibleDate } from "@/features/os/operational/lib/delivery-date";
import { parseNonNegativeNumber } from "@/features/os/operational/lib/clipboard-import";
import type { SectorId } from "@/types/operational/sector";
import type { WorkItem } from "@/types/operational/work-item";

export const WORK_ITEM_CELL_FIELDS = [
  "client",
  "product",
  "plannedQuantity",
  "unit",
  "plannedDate",
  "deliveryDate",
  "notes",
  "packagingLote",
  "packagingVto",
  /** Responsable (Elaboración: Cristian / Nicolás) o línea (Envasado: Línea N). */
  "assignee",
  /** Corrección autorizada de la cantidad realizada (motivo obligatorio; no es un avance). */
  "finishedQty",
] as const;
export type WorkItemCellField = (typeof WORK_ITEM_CELL_FIELDS)[number];

export const WORK_ITEM_CELL_KIND: Record<WorkItemCellField, "text" | "number" | "date"> = {
  client: "text", product: "text", plannedQuantity: "number", unit: "text",
  plannedDate: "date", deliveryDate: "date", notes: "text", packagingLote: "text", packagingVto: "date", assignee: "text", finishedQty: "number",
};
/** Identidad / trazabilidad (re-resuelve OA/OE o es dato de lote): confirmación reforzada. */
export const WORK_ITEM_SENSITIVE_FIELDS: ReadonlySet<WorkItemCellField> = new Set(["product", "packagingLote", "packagingVto"]);
/** Estas correcciones exigen motivo auditado en la función canónica. */
export const WORK_ITEM_REASON_FIELDS: ReadonlySet<WorkItemCellField> = new Set(["packagingLote", "packagingVto", "finishedQty"]);
export const MIN_WORK_ITEM_REASON = 8;

export function isWorkItemCellField(v: unknown): v is WorkItemCellField {
  return typeof v === "string" && (WORK_ITEM_CELL_FIELDS as readonly string[]).includes(v);
}

const NATIVE_PREFIX = "native:";
export const isNativeWorkItemId = (id: string) => id.startsWith(NATIVE_PREFIX) && id.length > NATIVE_PREFIX.length;

const CLOSED_STATUSES = new Set(["cancelado", "entregado"]);
const REPORTED_STATUSES = new Set(["completo", "revision", "codificado_completo", "en_codificado"]);

type ProtectableItem = Pick<
  WorkItem,
  "id" | "status" | "qualityStatus" | "packagingClosedAt" | "deliveredFromCodificadoAt" | "operationalCancelledAt"
>;

/** ¿El sector ya informó el trabajo (completo / en revisión / en Codificado)? Producción puede corregir CON motivo. */
export function isWorkItemReported(item: Pick<WorkItem, "status">): boolean {
  return REPORTED_STATUSES.has(item.status);
}

/** Motivo por el que la celda NO es editable (null = editable). Los cierres definitivos indican el procedimiento. */
export function workItemCellProtection(item: ProtectableItem & { sector?: string }, field: string, sector: SectorId | string | null | undefined): string | null {
  if (!isWorkItemCellField(field)) return "Columna de solo lectura (calculada o de otro sector).";
  if (field === "assignee" && item.sector === "CODIFICADO") return "Codificado no tiene responsable ni línea asignable.";
  if (sector !== "PRODUCCION") return "Solo Producción edita la planificación de trabajos.";
  if (!isNativeWorkItemId(item.id)) return "Trabajo de la planilla Google: se edita en Producción → Semanas.";
  if (item.operationalCancelledAt || CLOSED_STATUSES.has(item.status)) {
    return item.status === "entregado" ? "Trabajo entregado: cerrado. Para corregirlo, anulá la entrega en Entregas." : "Trabajo cancelado: restauralo antes de editarlo.";
  }
  if (item.qualityStatus === "aprobado" || item.qualityStatus === "rechazado") return "Calidad ya decidió: para corregir, anulá la decisión de Calidad (queda auditado).";
  if (item.packagingClosedAt) return "Envasado cerrado: no se modifica.";
  if (item.deliveredFromCodificadoAt) return "Entregado desde Codificado: no se modifica.";
  return null;
}

export type WorkItemCellValidation = { ok: true; value: string | null } | { ok: false; message: string };

export function validateWorkItemCellValue(field: WorkItemCellField, raw: unknown): WorkItemCellValidation {
  const text = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
  const kind = WORK_ITEM_CELL_KIND[field];
  if (field === "client" || field === "product") {
    if (!text) return { ok: false, message: "No puede quedar vacío." };
    return text.length > 300 ? { ok: false, message: "Máximo 300 caracteres." } : { ok: true, value: text };
  }
  if (field === "assignee") {
    // Se normaliza a la forma de la base (Cristian, Nicolás, Línea 1…); el servidor valida la combinación con el sector.
    const t = text.replace(/\s+/g, " ");
    if (!t) return { ok: false, message: "El responsable / la línea es obligatorio." };
    const linea = t.match(/^l[ií]nea\s*(\d)$/i) ?? t.match(/^(\d)$/);
    if (linea) return { ok: true, value: `Línea ${linea[1]}` };
    if (/^cristian$/i.test(t)) return { ok: true, value: "Cristian" };
    if (/^nicol[aá]s$/i.test(t)) return { ok: true, value: "Nicolás" };
    return { ok: false, message: "Usá Cristian / Nicolás (Elaboración) o Línea 1–4 (Envasado)." };
  }
  if (field === "unit") {
    if (!text) return { ok: false, message: "La unidad es obligatoria." };
    return text.length > 20 ? { ok: false, message: "Máximo 20 caracteres." } : { ok: true, value: text };
  }
  if (kind === "number") {
    const n = parseNonNegativeNumber(text);
    if (!text || n === null) return { ok: false, message: "Cantidad inválida (número ≥ 0)." };
    return { ok: true, value: String(n) };
  }
  if (kind === "date") {
    if (!text) return field === "plannedDate" ? { ok: false, message: "La fecha de producción es obligatoria." } : { ok: true, value: null };
    const iso = parseFlexibleDate(text);
    if (!iso || Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) return { ok: false, message: "Fecha inválida. Usá dd/mm/aaaa." };
    return { ok: true, value: iso };
  }
  return text.length > 1000 ? { ok: false, message: "Máximo 1000 caracteres." } : { ok: true, value: text || null };
}

/** ¿Pide motivo? (campos auditables siempre; trabajos ya informados por el sector; trabajos de fecha pasada). */
export function workItemReasonRequired(item: Pick<WorkItem, "plannedDate"> & { status?: WorkItem["status"] }, field: WorkItemCellField, today: string): boolean {
  if (WORK_ITEM_REASON_FIELDS.has(field)) return true;
  if (item.status && REPORTED_STATUSES.has(item.status)) return true;
  return Boolean(item.plannedDate && item.plannedDate < today);
}

export interface WorkItemCellChange {
  /** id del WorkItem proyectado (`native:<uuid>`). */
  id: string;
  field: WorkItemCellField;
  value: string;
  /** `WorkItem.version` que el usuario tenía al editar. */
  expectedVersion: number;
  reason?: string;
  /** Valor que el usuario veía (solo `finishedQty`: detecta un avance del sector registrado mientras tanto). */
  expectedValue?: string | null;
}
export type WorkItemCellResultCode = "NOT_FOUND" | "PROTECTED" | "INVALID" | "CONFLICT" | "REASON_REQUIRED" | "FORBIDDEN" | "ERROR";
export type WorkItemCellResult =
  | { index: number; ok: true; version: number }
  | { index: number; ok: false; code: WorkItemCellResultCode; message: string };
export const MAX_WORK_ITEM_CELL_CHANGES = 200;
