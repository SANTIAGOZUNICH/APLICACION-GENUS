import type { PlanningSector, PlanningWorkItemRecord } from "@/lib/planning/types";
import { SECTOR_LABELS } from "@/types/operational/sector";

export interface WeeklyPlanItemDto {
  workItemId: string;
  plannedDate: string;
  plannedDateTo: string;
  product: string;
  client: string;
  quantity: string;
  unit: string;
  sector: PlanningSector;
  sectorLabel: string;
  responsible: string | null;
  deliveryDate: string | null;
  status: string;
  statusLabel: string;
  lote: string | null;
  notes: string | null;
  progressLabel: string;
}

const STATUS_LABELS: Record<string, string> = {
  BORRADOR: "Borrador",
  PLANIFICADO: "Planificado",
  PUBLICADO: "Publicado",
  ESPERANDO_MATERIALES: "Esperando materiales",
  LISTO_PARA_INICIAR: "Listo para iniciar",
  EN_PROCESO: "En proceso",
  BLOQUEADO: "Bloqueado",
  TERMINADO_SECTOR: "Terminado sector",
  PENDIENTE_CALIDAD: "Pendiente calidad",
  RECHAZADO_CALIDAD: "Rechazado calidad",
  APROBADO_CALIDAD: "Aprobado calidad",
  LIBERADO: "Liberado",
  CANCELADO: "Cancelado",
};

function progressFromStatus(status: string): string {
  switch (status) {
    case "EN_PROCESO":
      return "En progreso";
    case "TERMINADO_SECTOR":
    case "APROBADO_CALIDAD":
    case "LIBERADO":
      return "Completado";
    case "BLOQUEADO":
    case "RECHAZADO_CALIDAD":
      return "Bloqueado";
    case "ESPERANDO_MATERIALES":
      return "Esperando materiales";
    case "LISTO_PARA_INICIAR":
    case "PUBLICADO":
    case "PLANIFICADO":
      return "Pendiente";
    default:
      return STATUS_LABELS[status] ?? status;
  }
}

/** Proyecta filas nativas al DTO de consulta (sin localStorage, sin duplicar ids). */
export function toWeeklyPlanItemDto(item: PlanningWorkItemRecord): WeeklyPlanItemDto {
  const plannedDateTo = item.plannedDateTo ?? item.plannedDate;
  const responsible = item.branchOwner?.trim() || item.line?.trim() || null;
  return {
    workItemId: item.id,
    plannedDate: item.plannedDate,
    plannedDateTo,
    product: item.product,
    client: item.client,
    quantity: item.plannedQuantity,
    unit: item.unit,
    sector: item.sector,
    sectorLabel: SECTOR_LABELS[item.sector] ?? item.sector,
    responsible,
    deliveryDate: null,
    status: item.status,
    statusLabel: STATUS_LABELS[item.status] ?? item.status,
    lote: null,
    notes: item.notes,
    progressLabel: progressFromStatus(item.status),
  };
}

export function toWeeklyPlanItemDtos(items: PlanningWorkItemRecord[]): WeeklyPlanItemDto[] {
  return items.map(toWeeklyPlanItemDto);
}
