import type { WeeklyPlanItemDto } from "@/lib/planning/weekly-plan-dto";
import { WORK_ITEM_STATUSES, type WorkItem, type WorkItemStatus } from "@/types/operational/work-item";
import type { SectorId } from "@/types/operational/sector";

const VALID = new Set<string>(WORK_ITEM_STATUSES);

/**
 * Proyecta un trabajo del plan compartido (solo lectura, `/api/v1/weekly-plans`) al mismo `WorkItem` que usa la vista de Elaboración,
 * para dibujarlo con las MISMAS tarjetas y el MISMO tablero semanal. No inventa datos: lo que el plan no trae queda en null.
 */
export function planItemToWorkItem(i: WeeklyPlanItemDto): WorkItem {
  const op = (i.operationalStatus ?? "").trim();
  const status: WorkItemStatus = i.status === "CANCELADO" ? "cancelado" : VALID.has(op) ? (op as WorkItemStatus) : "pendiente";
  return {
    id: i.workItemId,
    sector: i.sector as SectorId,
    ownerSector: i.sector as SectorId,
    ownerPerson: i.responsible,
    source: "semanas_2026",
    sourceFileId: "",
    sourceSheet: null,
    sourceRange: null,
    productSourceRange: null,
    quantitySourceRange: null,
    originStage: "ELABORACION",
    date: null,
    plannedDate: i.plannedDate || null,
    plannedDateTo: i.plannedDateTo && i.plannedDateTo !== i.plannedDate ? i.plannedDateTo : null,
    dayLabel: null,
    dayOfWeek: null,
    weekLabel: null,
    weekStart: null,
    weekId: null,
    client: i.client,
    product: i.product,
    quantity: i.quantity,
    unit: i.unit,
    line: null,
    deliveryDate: i.deliveryDate,
    status,
    priority: null,
    pedidoRef: null,
    oeRef: null,
    oaRef: null,
    loteRef: i.lote,
    notes: i.notes,
    actionLabel: null,
    href: null,
    confidence: "high",
    createdFrom: "Genus OS · planificación nativa",
    generatedEntities: [],
    dependsOn: null,
    blockedBy: null,
    unblocks: null,
    // Kg realmente elaborados: solo lo informado (nunca se asume lo solicitado).
    finishedQty: i.elaboracion?.elaboratedKg != null ? String(i.elaboracion.elaboratedKg) : null,
    packagingLote: i.lote,
  };
}
