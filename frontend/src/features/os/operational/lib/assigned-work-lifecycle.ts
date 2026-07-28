import type { WorkItem, WorkItemStatus } from "@/types/operational/work-item";
import {
  canAnnul,
  canArchive,
  canDelete,
  type LifecycleDecision,
} from "@/lib/lifecycle";

export type AssignedWorkLifecycleAction =
  | "eliminar"
  | "cancelar"
  | "archivar"
  | "bloquear_finalizado";

export interface AssignedWorkLifecycleDecision {
  action: AssignedWorkLifecycleAction;
  reason: string;
}

function toLegacy(d: LifecycleDecision): AssignedWorkLifecycleDecision {
  if (!d.allowed || d.action === "bloquear") {
    return { action: "bloquear_finalizado", reason: d.reason };
  }
  if (d.action === "eliminar") return { action: "eliminar", reason: d.reason };
  if (d.action === "anular") return { action: "cancelar", reason: d.reason };
  if (d.action === "archivar") return { action: "archivar", reason: d.reason };
  return { action: "bloquear_finalizado", reason: d.reason };
}

/**
 * Decide la acción permitida según estado y avance — delega en política universal.
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
          ? "Este trabajo ya fue entregado. Gestioná la entrega desde Entregados o archivá el trabajo."
          : "Este trabajo ya fue finalizado y no puede eliminarse. Podés archivarlo o solicitar una corrección.",
    };
  }

  if (status === "revision" || status === "en_curso" || status === "bloqueado" || hasProgress) {
    return toLegacy(
      canAnnul({
        kind: "trabajo",
        id: "work",
        status,
        isDraft: false,
        hasProgress: true,
      })
    );
  }

  if (status === "pendiente") {
    return toLegacy(
      canDelete({
        kind: "trabajo",
        id: "work",
        status: "pendiente",
        isDraft: true,
        hasProgress: false,
      })
    );
  }

  return {
    action: "cancelar",
    reason: "El trabajo tiene historial. Preferí cancelarlo en lugar de borrarlo.",
  };
}
