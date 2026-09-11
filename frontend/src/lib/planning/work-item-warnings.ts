import type { WorkItem } from "@/types/operational/work-item";
import { summarizePackingGroups } from "@/lib/remitos/packing-math";

/**
 * Contrato único de advertencias NO BLOQUEANTES por datos operativos
 * faltantes en el WorkItem. Se calcula 100% a partir del WorkItem actual —
 * no crea ni depende de ningún estado nuevo en DB. Todas las pantallas
 * (tarjeta, drawer/detalle, diálogos "enviar a Codificado"/"enviar a
 * Calidad", Calidad, Producción, Expedición) deben llamar a
 * getWorkItemWarnings()/getWorkItemWarningCodes() en vez de reinventar su
 * propio criterio de "qué falta".
 *
 * Regla dura: esto es información visual pura. Ninguna acción (guardar
 * avance, enviar, completar, entregar) debe consultar este módulo para
 * habilitar/deshabilitar nada — el usuario SIEMPRE puede continuar aunque
 * falte todo.
 */
export const WORK_ITEM_WARNING_CODES = [
  "FALTA_LOTE",
  "FALTA_VTO",
  "FALTA_CANTIDAD_FINAL",
  "FALTA_PACKING",
  "FALTA_SOBRANTE",
] as const;
export type WorkItemWarningCode = (typeof WORK_ITEM_WARNING_CODES)[number];

/** Campo al que apunta cada advertencia — usado para "abrir el campo faltante". */
export type WorkItemWarningField = "lote" | "vto" | "cantidadFinal" | "packing" | "sobrante";

export interface WorkItemWarning {
  code: WorkItemWarningCode;
  /** Texto corto en mayúsculas, listo para mostrar en rojo (ej. "FALTA LOTE"). */
  label: string;
  field: WorkItemWarningField;
}

const WARNING_LABEL: Record<WorkItemWarningCode, string> = {
  FALTA_LOTE: "FALTA LOTE",
  FALTA_VTO: "FALTA VTO",
  FALTA_CANTIDAD_FINAL: "FALTA CANTIDAD FINAL",
  FALTA_PACKING: "FALTAN DATOS DE PACKING",
  FALTA_SOBRANTE: "FALTA SOBRANTE",
};

const WARNING_FIELD: Record<WorkItemWarningCode, WorkItemWarningField> = {
  FALTA_LOTE: "lote",
  FALTA_VTO: "vto",
  FALTA_CANTIDAD_FINAL: "cantidadFinal",
  FALTA_PACKING: "packing",
  FALTA_SOBRANTE: "sobrante",
};

/** Estados en los que el trabajo todavía no arrancó — nada que advertir. */
const SUPPRESSED_STATUSES: ReadonlySet<WorkItem["status"]> = new Set(["pendiente", "cancelado"]);

function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim() === "";
}

/**
 * Un WorkItem originado en ELABORACION (granel puro, nunca pasa por
 * Envasado/Acondicionamiento) no tiene noción de packing — no corresponde
 * pedirle cajas/unidades por caja.
 */
function packingApplies(item: Pick<WorkItem, "originStage">): boolean {
  return item.originStage !== "ELABORACION";
}

/**
 * Sobrante: NO es un campo obligatorio en general (por eso los diálogos de
 * envío lo dejan opcional). Solo tiene sentido pedirlo cuando existe una
 * diferencia real entre lo planificado y lo terminado y todavía nada la
 * explica (ni sobrante de granel cargado, ni una observación de mismatch de
 * packing). Si no hay gap, nunca se advierte.
 */
function hasUnexplainedGap(item: WorkItem): boolean {
  const planned = Number.parseFloat(item.quantity ?? "");
  const finished = Number.parseFloat(item.finishedQty ?? "");
  if (!Number.isFinite(planned) || !Number.isFinite(finished)) return false;
  if (planned <= finished) return false;
  const explained =
    item.bulkRemainderKg != null ||
    !isBlank(item.bulkRemainderObservation ?? null) ||
    !isBlank(item.packingMismatchObservation ?? null);
  return !explained;
}

/**
 * Devuelve los códigos de advertencia que aplican al WorkItem actual, en
 * orden de prioridad (lote/vto primero). Muestras NUNCA genera advertencia
 * — es metadata pura, nunca un dato obligatorio.
 */
export function getWorkItemWarningCodes(item: WorkItem): WorkItemWarningCode[] {
  if (SUPPRESSED_STATUSES.has(item.status)) return [];

  const codes: WorkItemWarningCode[] = [];

  const lote = item.packagingLote ?? item.loteRef ?? null;
  if (isBlank(lote)) codes.push("FALTA_LOTE");

  if (isBlank(item.packagingVto ?? null)) codes.push("FALTA_VTO");

  if (isBlank(item.finishedQty ?? null)) codes.push("FALTA_CANTIDAD_FINAL");

  if (packingApplies(item)) {
    const { totalEmbalado } = summarizePackingGroups(item.packingGroups ?? []);
    if (totalEmbalado <= 0) codes.push("FALTA_PACKING");
  }

  if (hasUnexplainedGap(item)) codes.push("FALTA_SOBRANTE");

  return codes;
}

/** Igual que getWorkItemWarningCodes pero con label/field listos para UI. */
export function getWorkItemWarnings(item: WorkItem): WorkItemWarning[] {
  return getWorkItemWarningCodes(item).map((code) => ({
    code,
    label: WARNING_LABEL[code],
    field: WARNING_FIELD[code],
  }));
}

/**
 * Etiqueta principal combinada para espacios chicos (tarjeta). Combina
 * LOTE+VTO en un solo mensaje ("FALTA LOTE Y VTO") porque es el caso más
 * común (Caso A del audit de integridad); el resto se indica como "+N" y se
 * puede ver completo en el detalle.
 */
export function getPrimaryWorkItemWarningLabel(warnings: WorkItemWarning[]): string | null {
  if (warnings.length === 0) return null;

  const codes = new Set(warnings.map((w) => w.code));
  const extra = warnings.filter((w) => w.code !== "FALTA_LOTE" && w.code !== "FALTA_VTO");

  if (codes.has("FALTA_LOTE") && codes.has("FALTA_VTO")) {
    return extra.length > 0 ? `FALTA LOTE Y VTO (+${extra.length})` : "FALTA LOTE Y VTO";
  }

  const [first, ...rest] = warnings;
  return rest.length > 0 ? `${first.label} (+${rest.length})` : first.label;
}
