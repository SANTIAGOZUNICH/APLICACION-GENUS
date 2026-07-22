import type { WorkItem, WorkItemStatus } from "@/types/operational/work-item";

export type AssignedWorkLifecycleAction =
  | "eliminar"
  | "cancelar"
  | "archivar"
  | "bloquear_finalizado";

export interface AssignedWorkLifecycleDecision {
  action: AssignedWorkLifecycleAction;
  reason: string;
}

/**
 * Decide la acción permitida según estado y avance registrado.
 * - pendiente sin avance → eliminar
 * - en_curso / con avance / revision → cancelar (baja lógica)
 * - completo → no eliminar; archivar opcional
 * - cancelado → ya cancelado
 */
export function resolveAssignedWorkLifecycleAction(
  item: Pick<WorkItem, "status"> & { finishedQty?: string | null },
  options?: { hasProgressRecord?: boolean }
): AssignedWorkLifecycleDecision {
  const status = item.status as WorkItemStatus;
  const hasQty = Boolean(item.finishedQty && String(item.finishedQty).trim() !== "");
  const hasProgress = Boolean(options?.hasProgressRecord) || hasQty;

  if (status === "cancelado") {
    return {
      action: "bloquear_finalizado",
      reason: "Este trabajo ya está cancelado.",
    };
  }

  if (status === "completo" || status === "entregado") {
    return {
      action: "archivar",
      reason:
        status === "entregado"
          ? "Este trabajo ya fue entregado. Gestioná la entrega desde Entregados."
          : "Este trabajo ya fue finalizado y no puede eliminarse. Podés archivarlo o solicitar una corrección.",
    };
  }

  if (status === "revision") {
    return {
      action: "cancelar",
      reason: "El trabajo ya tiene actividad o fue enviado a Calidad. Solo puede cancelarse.",
    };
  }

  if (status === "en_curso" || status === "bloqueado" || hasProgress) {
    return {
      action: "cancelar",
      reason: "El trabajo ya tiene actividad registrada. Solo puede cancelarse con motivo.",
    };
  }

  if (status === "pendiente") {
    return {
      action: "eliminar",
      reason: "Trabajo pendiente sin avances — puede eliminarse.",
    };
  }

  return {
    action: "cancelar",
    reason: "El trabajo tiene historial. Preferí cancelarlo en lugar de borrarlo.",
  };
}
