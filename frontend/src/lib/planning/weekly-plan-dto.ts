import type { PlanningSector, PlanningWorkItemRecord } from "@/lib/planning/types";
import { SECTOR_LABELS } from "@/types/operational/sector";
import type { ElaboracionFigures } from "@/lib/planning/elaboracion-figures";

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
  /** Estado ACTUAL del trabajo para personas (avance operativo; cae al estado de planificación). Para la tarjeta de la Vista mensual. */
  stateLabel: string;
  /** Avance operativo real (solo lectura): estado operativo y kg/unidades realizadas informadas por el sector (null = sin informar). */
  operationalStatus?: string | null;
  finishedQty?: string | null;
  /** Solo Elaboración: kg solicitados / elaborados / entregados / pendientes y estado real (renglones de entrega + envío a Envasado). */
  elaboracion?: ElaboracionFigures | null;
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

const OPERATIONAL_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  en_curso: "En curso",
  bloqueado: "Bloqueado",
  completo: "Completo",
  revision: "Terminado · pendiente de definir",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

/** Estado actual: lo que declaró el sector ejecutor (avance operativo); si no hay, el estado de la planificación. */
export function currentStateLabel(item: Pick<PlanningWorkItemRecord, "status" | "operationalStatus">): string {
  if (item.status === "CANCELADO") return "Cancelado";
  const op = (item.operationalStatus ?? "").trim();
  if (op && OPERATIONAL_LABELS[op]) return OPERATIONAL_LABELS[op]!;
  return progressFromStatus(item.status);
}

/** Proyecta filas nativas al DTO de consulta (sin localStorage, sin duplicar ids). */
export function toWeeklyPlanItemDto(item: PlanningWorkItemRecord): WeeklyPlanItemDto {
  const plannedDateTo = item.plannedDateTo ?? item.plannedDate ?? "";
  const responsible = item.branchOwner?.trim() || item.line?.trim() || null;
  return {
    workItemId: item.id,
    plannedDate: item.plannedDate ?? "",
    plannedDateTo,
    product: item.product,
    client: item.client,
    quantity: item.plannedQuantity,
    unit: item.unit,
    sector: item.sector,
    sectorLabel: SECTOR_LABELS[item.sector] ?? item.sector,
    responsible,
    deliveryDate: item.deliveryDate ?? null,
    status: item.status,
    statusLabel: STATUS_LABELS[item.status] ?? item.status,
    lote: item.packagingLote?.trim() || null,
    notes: item.notes,
    progressLabel: progressFromStatus(item.status),
    stateLabel: currentStateLabel(item),
    operationalStatus: item.operationalStatus ?? null,
    finishedQty: item.finishedQty ?? null,
  };
}

export function toWeeklyPlanItemDtos(items: PlanningWorkItemRecord[], figures?: Map<string, ElaboracionFigures>): WeeklyPlanItemDto[] {
  return items.map((i) => {
    const dto = toWeeklyPlanItemDto(i);
    const f = figures?.get(i.id);
    return f ? { ...dto, elaboracion: f, stateLabel: f.stateLabel } : dto;
  });
}
