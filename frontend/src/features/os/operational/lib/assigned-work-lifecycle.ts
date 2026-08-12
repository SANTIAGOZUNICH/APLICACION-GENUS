import type { WorkItem, WorkItemStatus } from "@/types/operational/work-item";
import type { SectorId } from "@/types/operational/sector";
import {
  canAnnul,
  canArchive,
  canDelete,
  canRestore,
  normalizeOptionalReason,
  type LifecycleAction,
  type LifecycleDecision,
} from "@/lib/lifecycle";
import type { LifecycleMenuItem } from "@/features/os/operational/components/lifecycle-actions-menu";
import {
  deleteOrCancelManualWorkItem,
  getManualWorkItemById,
  getManualWorkItemMeta,
  restoreManualWorkItem,
} from "../adapters/manual-work-items-repository";
import { recordWorkProgress } from "../store/operational-store";
import { postCancelWork, postDeleteWork, postRestoreWork } from "@/lib/api/live-sync-client";

export type AssignedWorkLifecycleAction =
  | "eliminar"
  | "cancelar"
  | "archivar"
  | "restaurar"
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
  if (d.action === "restaurar") return { action: "restaurar", reason: d.reason };
  return { action: "bloquear_finalizado", reason: d.reason };
}

function lifecycleActionLabel(action: LifecycleAction): string {
  switch (action) {
    case "eliminar":
      return "Eliminar trabajo";
    case "anular":
      return "Cancelar trabajo";
    case "archivar":
      return "Archivar";
    case "restaurar":
      return "Restaurar";
    case "eliminar_definitivo":
      return "Eliminar definitivo";
    default:
      return action;
  }
}

/**
 * Decide la acción permitida según estado y avance — delega en política universal.
 */
export function resolveAssignedWorkLifecycleAction(
  item: Pick<WorkItem, "status"> & { finishedQty?: string | null },
  options?: { hasProgressRecord?: boolean; inactiveKind?: "eliminado" | "archivado" | "cancelado" }
): AssignedWorkLifecycleDecision {
  const status = item.status as WorkItemStatus;
  const hasQty = Boolean(item.finishedQty && String(item.finishedQty).trim() !== "");
  const hasProgress = Boolean(options?.hasProgressRecord) || hasQty;

  if (status === "cancelado") {
    return {
      action: "restaurar",
      reason:
        "Restaurar devuelve el trabajo a la bandeja activa si no hay otro similar en curso.",
    };
  }

  if (options?.inactiveKind === "eliminado" || options?.inactiveKind === "archivado") {
    return {
      action: "restaurar",
      reason:
        options.inactiveKind === "eliminado"
          ? "Restaurar un trabajo eliminado lo devuelve a pendientes si no hay conflicto."
          : "Restaurar un trabajo archivado lo devuelve a la bandeja activa.",
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

/** Ítems de menú LifecycleActionsMenu para un trabajo asignado. */
export function buildAssignedWorkLifecycleMenuItems(
  item: Pick<WorkItem, "status"> & { finishedQty?: string | null },
  options?: {
    hasProgressRecord?: boolean;
    inactiveKind?: "eliminado" | "archivado" | "cancelado";
  }
): LifecycleMenuItem[] {
  const decision = resolveAssignedWorkLifecycleAction(item, options);
  const items: LifecycleMenuItem[] = [];

  if (decision.action === "restaurar") {
    const restore = canRestore({
      kind: "trabajo",
      id: "work",
      status: "ARCHIVADO",
      archived: true,
    });
    items.push({
      action: "restaurar",
      label: "Restaurar",
      decision: { ...restore, allowed: true, action: "restaurar", reason: decision.reason },
    });
    return items;
  }

  if (decision.action === "eliminar") {
    const del = canDelete({
      kind: "trabajo",
      id: "work",
      status: "pendiente",
      isDraft: true,
    });
    items.push({
      action: "eliminar",
      label: lifecycleActionLabel("eliminar"),
      decision: del.allowed ? del : { ...del, allowed: true, action: "eliminar", reason: decision.reason },
    });
  }

  if (decision.action === "cancelar") {
    const annul = canAnnul({
      kind: "trabajo",
      id: "work",
      status: item.status,
      hasProgress: true,
    });
    items.push({
      action: "anular",
      label: lifecycleActionLabel("anular"),
      decision: annul.allowed ? annul : { ...annul, allowed: true, action: "anular", reason: decision.reason },
    });
  }

  if (decision.action === "archivar") {
    const arch = canArchive({
      kind: "trabajo",
      id: "work",
      status: item.status,
    });
    items.push({
      action: "archivar",
      label: lifecycleActionLabel("archivar"),
      decision: arch.allowed ? arch : { ...arch, allowed: true, action: "archivar", reason: decision.reason },
    });
  }

  return items.filter((i) => i.decision.allowed);
}

export type AssignedWorkLifecycleExecuteResult =
  | { ok: true; message?: string }
  | { ok: false; error: string; code?: string };

/** Ejecuta acción de lifecycle con RBAC server-side vía live-sync cuando aplica. */
export async function executeAssignedWorkLifecycleAction(input: {
  action: LifecycleAction;
  item: WorkItem;
  actorSectorId: SectorId;
  actorName: string;
  finishedQty?: string;
  reason?: string;
}): Promise<AssignedWorkLifecycleExecuteResult> {
  const { action, item, actorSectorId, actorName, finishedQty = "", reason = "" } = input;
  const isManual = Boolean(getManualWorkItemById(item.id));

  if (action === "restaurar") {
    if (isManual) {
      const result = restoreManualWorkItem({
        id: item.id,
        actorSectorId,
        actorName,
      });
      if (!result.ok) {
        return { ok: false, error: result.error, code: result.code };
      }
      if (item.status === "cancelado") {
        const response = await postRestoreWork({
          itemId: item.id,
          actorSectorId,
          restoredBy: actorName,
          reason: reason.trim() || undefined,
          sector: item.sector,
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          return { ok: false, error: body.error ?? "No se pudo sincronizar la restauración." };
        }
      }
      return { ok: true, message: "Trabajo restaurado. Volvió a la bandeja activa." };
    }

    const response = await postRestoreWork({
      itemId: item.id,
      actorSectorId,
      restoredBy: actorName,
      reason: reason.trim() || undefined,
      sector: item.sector,
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? "No se pudo restaurar el trabajo." };
    }
    recordWorkProgress(item.id, {
      finishedQty: finishedQty || "",
      observation: reason.trim() ? `Restaurado: ${reason.trim()}` : "Restaurado",
      status: "en_curso",
      updatedBy: actorName,
    });
    return { ok: true, message: "Trabajo de planilla restaurado." };
  }

  if (action === "archivar") {
    if (!isManual) {
      // Producción borra (soft delete/tombstone, 0025) — no hay "archivar"
      // real para trabajos nativos, así que esta decisión de lifecycle
      // (mostrada para completo/entregado/en Codificado/etc.) se resuelve
      // borrando: preserva OA/packing/muestras/decisiones/eventos/entregas,
      // solo lo quita de las vistas operativas activas.
      const response = await postDeleteWork({
        itemId: item.id,
        reason: normalizeOptionalReason(reason),
        deletedBy: actorName,
        actorSectorId,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: body.error ?? "No se pudo borrar el trabajo." };
      }
      return { ok: true, message: "Trabajo borrado. Se quitó del flujo operativo." };
    }
    const meta = getManualWorkItemMeta(item.id);
    if (meta?.archived) {
      return { ok: false, error: "Ya está archivado." };
    }
    return {
      ok: false,
      error: "Archivar trabajos manuales activos no está habilitado en esta vista.",
    };
  }

  if (isManual) {
    const mappedAction =
      action === "eliminar" ? "eliminar" : action === "anular" ? "cancelar" : null;
    if (!mappedAction) {
      return { ok: false, error: "Acción no permitida para este trabajo." };
    }
    const result = deleteOrCancelManualWorkItem({
      id: item.id,
      actorSectorId,
      actorName,
      cancelReason: reason,
      hasProgressRecord: finishedQty.trim().length > 0,
      finishedQty,
    });
    if (!result.ok) {
      return { ok: false, error: result.error, code: result.code };
    }
    if (result.action === "cancelar") {
      const response = await postCancelWork({
        itemId: item.id,
        reason: normalizeOptionalReason(reason),
        cancelledBy: actorName,
        sector: item.sector,
        actorSectorId,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: body.error ?? "No se pudo sincronizar la cancelación." };
      }
    }
    return {
      ok: true,
      message:
        result.action === "eliminar"
          ? "Trabajo eliminado de las listas activas."
          : "Trabajo cancelado.",
    };
  }

  const cancelReason =
    action === "eliminar"
      ? "Eliminado por Producción (pendiente sin avances)."
      : normalizeOptionalReason(reason);
  recordWorkProgress(item.id, {
    finishedQty: finishedQty || "",
    observation: `Cancelado: ${cancelReason}`,
    status: "cancelado",
    updatedBy: actorName,
  });
  const response = await postCancelWork({
    itemId: item.id,
    reason: cancelReason,
    cancelledBy: actorName,
    sector: item.sector,
    actorSectorId,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? "No se pudo cancelar el trabajo." };
  }
  return {
    ok: true,
    message:
      action === "eliminar"
        ? "Trabajo de planilla quitado de listas activas (cancelado)."
        : "Trabajo de planilla cancelado.",
  };
}
