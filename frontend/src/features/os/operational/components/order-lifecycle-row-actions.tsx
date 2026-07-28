"use client";

import { useMemo } from "react";
import type { LifecycleAction } from "@/lib/lifecycle";
import { orderLifecycleActions } from "@/lib/lifecycle/adapters/orders";
import { canOrderAction } from "@/lib/orders/rbac";
import type { OperationalOrderRecord } from "@/lib/orders/types";
import type { SectorId } from "@/types/operational/sector";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import {
  annulOrderApi,
  archiveOrderApi,
  deleteEmptyDraftApi,
  restoreOrderApi,
} from "@/lib/orders/orders-client";
import type { LifecycleMenuItem } from "./lifecycle-actions-menu";
import { LifecycleRowActions } from "./lifecycle-row-actions";

function buildOrderLifecycleMenuItems(
  order: Pick<OperationalOrderRecord, "id" | "type" | "status">,
  sectorId: SectorId
): LifecycleMenuItem[] {
  const decisions = orderLifecycleActions(order);
  const items: LifecycleMenuItem[] = [];

  if (decisions.eliminar.allowed && canOrderAction(order.type, "delete_draft", sectorId)) {
    items.push({
      action: "eliminar",
      label: "Eliminar borrador",
      decision: decisions.eliminar,
    });
  }
  if (decisions.anular.allowed && canOrderAction(order.type, "annul", sectorId)) {
    items.push({
      action: "anular",
      label: "Anular",
      decision: decisions.anular,
      impact: {
        summary:
          order.type === "OE"
            ? "Revertirá el consumo de MP (kg reales) una sola vez por código y marcará la OE como ANULADA."
            : "Revertirá las salidas de materiales de empaque una sola vez y marcará la OA como ANULADA.",
        preservesAudit: true,
        references: [],
        warnings: ["Se conserva el historial legal y los snapshots de fórmula."],
      },
    });
  }
  if (decisions.archivar.allowed && canOrderAction(order.type, "archive", sectorId)) {
    items.push({
      action: "archivar",
      label: "Archivar",
      decision: decisions.archivar,
    });
  }
  if (decisions.restaurar.allowed && canOrderAction(order.type, "archive", sectorId)) {
    items.push({
      action: "restaurar",
      label: "Restaurar",
      decision: decisions.restaurar,
    });
  }

  return items;
}

export type OrderLifecycleRowActionsProps = {
  order: OperationalOrderRecord;
  session: OrdersClientSession;
  sectorId: SectorId;
  onOpen?: () => void;
  onChanged?: () => void;
  onError?: (message: string) => void;
  disabled?: boolean;
};

export function OrderLifecycleRowActions({
  order,
  session,
  sectorId,
  onOpen,
  onChanged,
  onError,
  disabled,
}: OrderLifecycleRowActionsProps) {
  const items = useMemo(
    () => buildOrderLifecycleMenuItems(order, sectorId),
    [order, sectorId]
  );

  const handleAction = async (action: LifecycleAction, reason: string) => {
    try {
      if (action === "eliminar") {
        await deleteEmptyDraftApi(session, order.id);
        onChanged?.();
        return;
      }
      if (action === "anular") {
        await annulOrderApi(session, order.id, reason);
        onChanged?.();
        return;
      }
      if (action === "archivar") {
        await archiveOrderApi(session, order.id);
        onChanged?.();
        return;
      }
      if (action === "restaurar") {
        await restoreOrderApi(session, order.id);
        onChanged?.();
      }
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "No se pudo completar la acción.");
      throw e;
    }
  };

  return (
    <LifecycleRowActions
      items={items}
      onAction={handleAction}
      onPrimary={onOpen}
      primaryLabel="Abrir"
      disabled={disabled}
      entityLabel={`${order.orderNumber} · ${order.product || "Sin producto"}`}
      entityStatus={order.status}
    />
  );
}

export { buildOrderLifecycleMenuItems };
