import type { PlanningWorkItemStatus } from "@/lib/planning/types";
import type { WorkItemStatus } from "@/types/operational/work-item";
import type { QualityDecisionStatus } from "@/features/os/operational/types";

/** DB → UI WorkItem.status */
export function toUiWorkStatus(status: PlanningWorkItemStatus): WorkItemStatus {
  switch (status) {
    case "EN_PROCESO":
      return "en_curso";
    case "PENDIENTE_CALIDAD":
    case "TERMINADO_SECTOR":
      return "revision";
    case "APROBADO_CALIDAD":
    case "LIBERADO":
      return "completo";
    case "RECHAZADO_CALIDAD":
    case "BLOQUEADO":
      return "bloqueado";
    case "CANCELADO":
      return "cancelado";
    default:
      return "pendiente";
  }
}

export function toUiQualityStatus(
  status: PlanningWorkItemStatus
): QualityDecisionStatus {
  if (status === "APROBADO_CALIDAD" || status === "LIBERADO") return "aprobado";
  if (status === "RECHAZADO_CALIDAD") return "rechazado";
  return "pendiente";
}
