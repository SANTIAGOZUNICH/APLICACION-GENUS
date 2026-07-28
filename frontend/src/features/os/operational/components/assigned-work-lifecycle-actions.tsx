"use client";

import { useMemo } from "react";
import type { SectorId } from "@/types/operational/sector";
import type { WorkItem } from "@/types/operational/work-item";
import type { LifecycleAction } from "@/lib/lifecycle";
import {
  buildAssignedWorkLifecycleMenuItems,
  executeAssignedWorkLifecycleAction,
} from "../lib/assigned-work-lifecycle";
import { canMutateAssignedWork } from "../lib/work-mutation-rbac";
import { LifecycleActionsMenu } from "./lifecycle-actions-menu";

interface AssignedWorkLifecycleActionsProps {
  item: WorkItem;
  actorSectorId: SectorId;
  actorName: string;
  finishedQty?: string;
  inactiveKind?: "eliminado" | "archivado" | "cancelado";
  onChanged?: () => void;
  onToast?: (message: string, tone?: "ok" | "info") => void;
  disabled?: boolean;
}

/**
 * Menú Acciones unificado para trabajos asignados (eliminar / cancelar / archivar / restaurar).
 */
export function AssignedWorkLifecycleActions({
  item,
  actorSectorId,
  actorName,
  finishedQty = "",
  inactiveKind,
  onChanged,
  onToast,
  disabled,
}: AssignedWorkLifecycleActionsProps) {
  const canMutate = canMutateAssignedWork(actorSectorId);

  const items = useMemo(
    () =>
      buildAssignedWorkLifecycleMenuItems(
        { status: item.status, finishedQty },
        { hasProgressRecord: finishedQty.trim().length > 0, inactiveKind }
      ),
    [item.status, finishedQty, inactiveKind]
  );

  if (!canMutate || items.length === 0) return null;

  const handleAction = async (action: LifecycleAction, reason: string) => {
    const result = await executeAssignedWorkLifecycleAction({
      action,
      item,
      actorSectorId,
      actorName,
      finishedQty,
      reason,
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
    onToast?.(
      result.message ??
        (action === "restaurar"
          ? "Trabajo restaurado."
          : action === "eliminar"
            ? "Trabajo eliminado de las listas activas."
            : action === "anular"
              ? "Trabajo cancelado."
              : action === "archivar"
                ? "Trabajo archivado."
                : "Acción completada.")
    );
    onChanged?.();
  };

  return (
    <LifecycleActionsMenu
      items={items}
      onAction={handleAction}
      disabled={disabled}
      align="right"
    />
  );
}

/** Re-export helpers for historial / tests. */
export {
  buildAssignedWorkLifecycleMenuItems,
  executeAssignedWorkLifecycleAction,
} from "../lib/assigned-work-lifecycle";
