import {
  dayOfWeekName,
  resolveWeekId,
  weekStartMonday,
} from "@/lib/operational/operational-calendar";
import type { PlanningWorkItemRecord } from "@/lib/planning/types";
import { toNativeQualityItemId, toNativeWorkItemId } from "@/lib/planning/native-id";
import { toUiQualityStatus, toUiWorkStatus } from "@/lib/planning/status-map";
import type { WorkItem } from "@/types/operational/work-item";
import type { QualityItem } from "@/features/os/operational/types";

/** Proyecta filas nativas al contrato WorkItem actual de /mi-trabajo. */
export function projectNativeWorkItem(item: PlanningWorkItemRecord): WorkItem {
  const weekStart = weekStartMonday(item.plannedDate);
  return {
    id: toNativeWorkItemId(item.id),
    sector: item.sector,
    ownerSector: item.sector,
    ownerPerson: item.branchOwner,
    source: "semanas_2026",
    sourceFileId: "genus-os-native",
    sourceSheet: "native_planning",
    sourceRange: null,
    productSourceRange: null,
    quantitySourceRange: null,
    originStage:
      item.sector === "ELABORACION" ? "ELABORACION" : "ACONDICIONAMIENTO",
    date: item.plannedDate,
    plannedDate: item.plannedDate,
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
    deliveryDate: null,
    status: toUiWorkStatus(item.status),
    priority: item.priority,
    pedidoRef: null,
    oeRef: null,
    oaRef: null,
    loteRef: null,
    notes: item.notes,
    actionLabel:
      item.sector === "ELABORACION" ? "Abrir OE" : "Abrir trabajo",
    href: null,
    confidence: "high",
    createdFrom: "Genus OS · planificación nativa",
    generatedEntities: [],
    dependsOn: null,
    blockedBy: null,
    unblocks: null,
    finishedQty: item.finishedQuantity,
    operationalObservation: item.operationalObservation,
  };
}

export function projectNativeWorkItems(
  items: PlanningWorkItemRecord[]
): WorkItem[] {
  return items.map(projectNativeWorkItem);
}

/** Bandeja Calidad desde WorkItems entregados / decididos. */
export function projectNativeQualityItems(
  items: PlanningWorkItemRecord[]
): QualityItem[] {
  return items
    .filter((item) =>
      ["PENDIENTE_CALIDAD", "APROBADO_CALIDAD", "RECHAZADO_CALIDAD"].includes(
        item.status
      )
    )
    .map((item) => ({
      id: toNativeQualityItemId(item.id),
      kind: item.sector === "ELABORACION" ? ("granel" as const) : ("salida" as const),
      lote: null,
      product: item.product,
      client: item.client,
      oe: null,
      oa: null,
      line: item.line,
      quantity: item.finishedQuantity ?? item.plannedQuantity,
      dayLabel: dayOfWeekName(item.plannedDate),
      status: toUiQualityStatus(item.status),
      relatedWorkItemId: toNativeWorkItemId(item.id),
      receivedFrom: item.sector,
      completedAt: item.completedAt,
      completedBy: item.completedBy,
      observation: item.operationalObservation,
    }));
}
