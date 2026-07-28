"use client";

import { useMemo } from "react";
import type { LifecycleAction } from "@/lib/lifecycle";
import { deliveryLifecycleActions } from "@/lib/lifecycle/adapters/common";
import type { DeliveryRecord } from "../adapters/delivery-repository";
import { LifecycleActionsMenu } from "./lifecycle-actions-menu";

type Props = {
  record: DeliveryRecord;
  canMutate: boolean;
  onAction: (action: LifecycleAction, reason: string) => void | Promise<void>;
  /** Incluir eliminar definitivo (archivados). */
  includeHardDelete?: boolean;
  hardDeleteDecision?: ReturnType<typeof deliveryLifecycleActions>["eliminarDefinitivo"];
  onHardDelete?: (reason: string) => void | Promise<void>;
  disabled?: boolean;
};

/**
 * Menú Acciones unificado para entregas (archivar / restaurar / anular / borrar).
 */
export function DeliveryLifecycleActions({
  record,
  canMutate,
  onAction,
  includeHardDelete,
  hardDeleteDecision,
  onHardDelete,
  disabled,
}: Props) {
  const lifecycle = useMemo(
    () =>
      deliveryLifecycleActions({
        id: record.id,
        status: record.status,
        archived: record.archived,
      }),
    [record.archived, record.id, record.status]
  );

  if (!canMutate) return null;

  const items = [
    ...(lifecycle.archivar.allowed
      ? [{ action: "archivar" as const, label: "Archivar", decision: lifecycle.archivar }]
      : []),
    ...(lifecycle.restaurar.allowed
      ? [{ action: "restaurar" as const, label: "Restaurar", decision: lifecycle.restaurar }]
      : []),
    ...(lifecycle.anular.allowed
      ? [
          {
            action: "anular" as const,
            label: "Anular entrega",
            decision: lifecycle.anular,
            impact: {
              summary:
                "La entrega volverá a pendientes de entrega. El trabajo recuperará estado de revisión/aprobado.",
              preservesAudit: true,
              references: [],
              warnings: [],
            },
          },
        ]
      : []),
    ...(includeHardDelete && hardDeleteDecision?.allowed
      ? [
          {
            action: "eliminar_definitivo" as const,
            label: "Borrar entrega",
            decision: hardDeleteDecision,
            impact: hardDeleteDecision.impact,
          },
        ]
      : []),
  ];

  if (items.length === 0) return null;

  return (
    <LifecycleActionsMenu
      items={items}
      disabled={disabled}
      onAction={async (action, reason) => {
        if (action === "eliminar_definitivo" && onHardDelete) {
          await onHardDelete(reason);
          return;
        }
        await onAction(action, reason);
      }}
    />
  );
}
