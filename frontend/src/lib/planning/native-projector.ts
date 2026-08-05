import {
  dayOfWeekName,
  resolveWeekId,
  weekStartMonday,
} from "@/lib/operational/operational-calendar";
import type { PlanningWorkItemRecord } from "@/lib/planning/types";
import type { SectorId } from "@/types/operational/sector";
import type { WorkItem, WorkItemStatus } from "@/types/operational/work-item";

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
  // Asignación directa a Codificado (sin handoff Envasado).
  if (item.sector === "CODIFICADO" && !item.viaCodificado) {
    return "pendiente";
  }
  // Cancelado: de vuelta en Envasado editable.
  if (item.codificadoCancelledAt && item.sector !== "CODIFICADO") {
    return "pendiente";
  }
  return "pendiente";
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
      item.packagingTotalUnits != null ? String(item.packagingTotalUnits) : null,
    operationalObservation: item.codificadoObservation ?? item.notes,
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
