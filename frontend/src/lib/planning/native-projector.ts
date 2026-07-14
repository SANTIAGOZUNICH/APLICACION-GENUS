import {
  dayOfWeekName,
  resolveWeekId,
  weekStartMonday,
} from "@/lib/operational/operational-calendar";
import type { PlanningWorkItemRecord } from "@/lib/planning/types";
import type { WorkItem } from "@/types/operational/work-item";

/** Proyecta filas nativas al contrato WorkItem actual de /mi-trabajo. */
export function projectNativeWorkItem(item: PlanningWorkItemRecord): WorkItem {
  const weekStart = weekStartMonday(item.plannedDate);
  return {
    id: `native:${item.id}`,
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
    status: "pendiente",
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
  };
}

export function projectNativeWorkItems(
  items: PlanningWorkItemRecord[]
): WorkItem[] {
  return items.map(projectNativeWorkItem);
}
