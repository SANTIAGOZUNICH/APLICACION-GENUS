"use client";

import { useMemo } from "react";
import type { LifecycleAction } from "@/lib/lifecycle";
import { deliveryLifecycleActions } from "@/lib/lifecycle/adapters/common";
import type { DeliveryRecord } from "../adapters/delivery-repository";
import type { LifecycleMenuItem } from "./lifecycle-actions-menu";
import { LifecycleRowActions } from "./lifecycle-row-actions";

type Props = {
  record: DeliveryRecord;
  canMutate: boolean;
  onAction: (action: LifecycleAction, reason: string) => void | Promise<void>;
  /** Incluir eliminar definitivo (archivados). */
  includeHardDelete?: boolean;
  hardDeleteDecision?: ReturnType<typeof deliveryLifecycleActions>["eliminarDefinitivo"];
  onHardDelete?: (reason: string) => void | Promise<void>;
  disabled?: boolean;
  onOpen?: () => void;
  primaryLabel?: string;
};

/**
 * Acciones de fila para entregas: [Abrir?] [Borrar] + menú extra.
 */
export function DeliveryLifecycleActions({
  record,
  canMutate,
  onAction,
  includeHardDelete,
  hardDeleteDecision,
  onHardDelete,
  disabled,
  onOpen,
  primaryLabel = "Ver detalle",
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

  const items = useMemo(() => {
    const list: LifecycleMenuItem[] = [
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
    return list;
  }, [hardDeleteDecision, includeHardDelete, lifecycle]);

  if (!canMutate) {
    if (onOpen) {
      return (
        <LifecycleRowActions
          items={[]}
          onAction={async () => undefined}
          onPrimary={onOpen}
          primaryLabel={primaryLabel}
          disabled={disabled}
          entityLabel={record.product}
          entityStatus={record.status}
        />
      );
    }
    return null;
  }

  if (items.length === 0 && !onOpen) return null;

  return (
    <LifecycleRowActions
      items={items}
      onAction={async (action, reason) => {
        if (action === "eliminar_definitivo" && onHardDelete) {
          await onHardDelete(reason);
          return;
        }
        await onAction(action, reason);
      }}
      onPrimary={onOpen}
      primaryLabel={primaryLabel}
      disabled={disabled}
      entityLabel={`${record.product} · ${record.client ?? "Sin cliente"}`}
      entityStatus={record.status}
    />
  );
}
