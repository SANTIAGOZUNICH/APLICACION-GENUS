import {
  dayOfWeekName,
  resolveWeekId,
  weekStartMonday,
} from "@/lib/operational/operational-calendar";
import { normalizePackingGroups } from "@/lib/remitos/packing-math";
import type { PlanningWorkItemRecord } from "@/lib/planning/types";
import type { SectorId } from "@/types/operational/sector";
import type { WorkItem, WorkItemStatus } from "@/types/operational/work-item";

const VALID_OPERATIONAL_STATUSES: ReadonlySet<string> = new Set([
  "pendiente",
  "en_curso",
  "bloqueado",
  "completo",
  "revision",
  "entregado",
  "cancelado",
]);

/**
 * El flujo Codificado (rutas fijas por columnas work_items) manda sobre el
 * avance operativo genérico cuando aplica; fuera de esas transiciones, el
 * status real es el que declaró el sector ejecutor (operational_status,
 * durable en Neon — 0023), no un valor fijo.
 */
function resolveProjectedStatus(item: PlanningWorkItemRecord): WorkItemStatus {
  if (item.deliveredFromCodificadoAt) return "codificado_completo";
  if (
    item.sector === "CODIFICADO" &&
    item.viaCodificado &&
    item.sentToCodificadoAt &&
    !item.codificadoCancelledAt
  ) {
    return "en_codificado";
  }
  // Asignación directa a Codificado (sin handoff Envasado): respeta avance propio.
  if (item.sector === "CODIFICADO" && !item.viaCodificado) {
    return VALID_OPERATIONAL_STATUSES.has(item.operationalStatus ?? "")
      ? (item.operationalStatus as WorkItemStatus)
      : "pendiente";
  }
  // Cancelado desde Codificado: de vuelta en Envasado editable.
  if (item.codificadoCancelledAt && item.sector !== "CODIFICADO") {
    return "pendiente";
  }
  return VALID_OPERATIONAL_STATUSES.has(item.operationalStatus ?? "")
    ? (item.operationalStatus as WorkItemStatus)
    : "pendiente";
}

function originLabel(sector: string | null | undefined): string | null {
  if (sector === "ENVASADO_MASIVO") return "Envasado Masivo";
  if (sector === "ENVASADO_PREMIUM") return "Envasado Premium";
  if (sector === "PRODUCCION") return "Producción";
  return null;
}

/** Proyecta filas nativas al contrato WorkItem actual de /mi-trabajo. */
export function projectNativeWorkItem(item: PlanningWorkItemRecord): WorkItem {
  const weekStart = weekStartMonday(item.plannedDate);
  const packagingLote = item.packagingLote?.trim() || null;
  const packagingVto = item.packagingVto?.trim() || null;
  const orderNumber = item.orderNumber?.trim() || null;
  const originSector = (item.codificadoOriginSector ?? null) as SectorId | null;
  const ownerSector = (
    item.viaCodificado && originSector ? originSector : item.sector
  ) as SectorId;
  const status = resolveProjectedStatus(item);
  const revision = Number(item.codificadoRevision ?? 0);
  const origin =
    item.viaCodificado && originSector
      ? originLabel(originSector)
      : item.sector === "CODIFICADO"
        ? "Producción"
        : null;

  return {
    id: `native:${item.id}`,
    sector: item.sector,
    ownerSector,
    ownerPerson: item.branchOwner,
    source: "semanas_2026",
    sourceFileId: "genus-os-native",
    sourceSheet: "native_planning",
    sourceRange: null,
    productSourceRange: null,
    quantitySourceRange: null,
    originStage:
      item.sector === "ELABORACION"
        ? "ELABORACION"
        : item.sector === "CODIFICADO"
          ? "CODIFICADO"
          : "ACONDICIONAMIENTO",
    date: item.plannedDate,
    plannedDate: item.plannedDate,
    plannedDateTo: item.plannedDateTo ?? item.plannedDate,
    dateHeaderSourceRange: null,
    dateResolutionMethod: null,
    dayLabel: dayOfWeekName(item.plannedDate),
    dayOfWeek: dayOfWeekName(item.plannedDate),
    weekLabel: `Semana ${weekStart}`,
    weekStart,
    weekId: resolveWeekId(item.plannedDate),
    client: item.client,
    product: item.product,
    quantity: item.plannedQuantity,
    unit: item.unit,
    line: item.line,
    lineExpectedInSheet: item.line != null,
    deliveryDate: item.deliveryDate ?? null,
    status,
    priority: item.priority,
    pedidoRef: item.productionPedidoId ?? null,
    oeRef: item.sector === "ELABORACION" ? orderNumber : null,
    oaRef: item.sector !== "ELABORACION" ? orderNumber : null,
    loteRef: packagingLote,
    notes: item.notes,
    packagingLote,
    packagingVto,
    packagingTotalUnits:
      item.packagingTotalUnits == null ? null : Number(item.packagingTotalUnits),
    packingGroups: (item.packingGroups as WorkItem["packingGroups"]) ?? null,
    // Legacy: cajas/unidadesPorCaja = grupo[0] de packingGroups (fuente canónica).
    packagingCajas: normalizePackingGroups(
      item.packingGroups as Array<{ cajas?: number; unidadesPorCaja?: number }> | null
    )[0]?.cajas ?? null,
    packagingUnidadesPorCaja: normalizePackingGroups(
      item.packingGroups as Array<{ cajas?: number; unidadesPorCaja?: number }> | null
    )[0]?.unidadesPorCaja ?? null,
    packingMismatchObservation: item.packingMismatchObservation ?? null,
    actionLabel:
      item.sector === "ELABORACION" ? "Abrir OE" : "Abrir trabajo",
    href: null,
    confidence: "high",
    createdFrom: "Genus OS · planificación nativa",
    generatedEntities: [],
    dependsOn: null,
    blockedBy: null,
    unblocks: null,
    finishedQty:
      item.finishedQty ??
      (item.packagingTotalUnits != null ? String(item.packagingTotalUnits) : null),
    operationalObservation:
      item.operationalObservation ?? item.codificadoObservation ?? item.notes,
    completedAt: item.completedAt ?? null,
    completedBy: item.completedBy ?? null,
    progressUpdatedAt: item.progressUpdatedAt ?? null,
    progressUpdatedBy: item.progressUpdatedBy ?? null,
    operationalCancelledAt: item.operationalCancelledAt ?? null,
    operationalCancelledBy: item.operationalCancelledBy ?? null,
    operationalCancelReason: item.operationalCancelReason ?? null,
    qualityStatus:
      (item.qualityStatus as WorkItem["qualityStatus"]) ?? "pendiente",
    qualityDecidedAt: item.qualityDecidedAt ?? null,
    qualityDecidedBy: item.qualityDecidedBy ?? null,
    qualityDecidedBySector: item.qualityDecidedBySector ?? null,
    qualityObservation: item.qualityObservation ?? null,
    qualityChangeReason: item.qualityChangeReason ?? null,
    codificadoOriginSector: originSector,
    codificadoOriginLabel: origin,
    sentToCodificadoAt: item.sentToCodificadoAt ?? null,
    sentToCodificadoBy: item.sentToCodificadoBy ?? null,
    deliveredFromCodificadoAt: item.deliveredFromCodificadoAt ?? null,
    deliveredFromCodificadoBy: item.deliveredFromCodificadoBy ?? null,
    viaCodificado: Boolean(item.viaCodificado),
    codificadoRevision: revision,
    codificadoCancelledAt: item.codificadoCancelledAt ?? null,
    bulkRemainderKg: item.bulkRemainderKg ?? null,
    bulkRemainderObservation: item.bulkRemainderObservation ?? null,
    bulkRemainderId: item.bulkRemainderId ?? null,
    nativeVersion: item.version,
    nativeId: item.id,
  };
}

export function projectNativeWorkItems(
  items: PlanningWorkItemRecord[]
): WorkItem[] {
  return items.map(projectNativeWorkItem);
}

const QUALITY_STATUSES: ReadonlySet<string> = new Set(["pendiente", "aprobado", "rechazado"]);

/**
 * Proyecta un work item completado (completedAt IS NOT NULL) a la forma
 * QualityItem que consume CalidadOperationalView — cola de Calidad nativa
 * (pendientes/aprobados/rechazados), sourced 100% de Neon (quality_status,
 * quality_observation, quality_decided_at/by/sector — 0023).
 */
export function projectQualityItem(item: PlanningWorkItemRecord): {
  id: string;
  kind: "granel" | "salida";
  lote: string | null;
  product: string;
  client: string;
  oe: string | null;
  oa: string | null;
  line: string | null;
  quantity: string | null;
  dayLabel: string;
  deliveryDate: string | null;
  status: "pendiente" | "aprobado" | "rechazado";
  relatedWorkItemId: string;
  receivedFrom: SectorId | null;
  completedAt: string | null;
  completedBy: string | null;
  observation: string | null;
} {
  const orderNumber = item.orderNumber?.trim() || null;
  const packagingLote = item.packagingLote?.trim() || null;
  const id = `native:${item.id}`;
  const status = QUALITY_STATUSES.has(item.qualityStatus ?? "")
    ? (item.qualityStatus as "pendiente" | "aprobado" | "rechazado")
    : "pendiente";

  return {
    id,
    kind: item.sector === "ELABORACION" ? "granel" : "salida",
    lote: packagingLote,
    product: item.product,
    client: item.client,
    oe: item.sector === "ELABORACION" ? orderNumber : null,
    oa: item.sector !== "ELABORACION" ? orderNumber : null,
    line: item.line,
    quantity: item.finishedQty ?? item.plannedQuantity,
    dayLabel: dayOfWeekName(item.plannedDate) ?? "—",
    deliveryDate: item.deliveryDate ?? null,
    status,
    relatedWorkItemId: id,
    receivedFrom: (item.sector as SectorId) ?? null,
    completedAt: item.completedAt ?? null,
    completedBy: item.completedBy ?? null,
    observation: item.qualityObservation ?? item.operationalObservation ?? null,
  };
}

export function projectQualityItems(
  items: PlanningWorkItemRecord[]
): ReturnType<typeof projectQualityItem>[] {
  return items.map(projectQualityItem);
}
