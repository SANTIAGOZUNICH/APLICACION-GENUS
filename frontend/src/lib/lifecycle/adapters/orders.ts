import type { OperationalOrderRecord } from "@/lib/orders/types";
import {
  canAnnul,
  canArchive,
  canDelete,
  canRestore,
  type LifecycleDecision,
  type LifecycleEntityState,
} from "@/lib/lifecycle";

export function orderToLifecycleState(
  order: Pick<OperationalOrderRecord, "id" | "type" | "status">
): LifecycleEntityState {
  return {
    kind: order.type === "OE" ? "oe" : "oa",
    id: order.id,
    status: order.status,
    isDraft: order.status === "BORRADOR",
    archived: order.status === "ARCHIVADA",
    deleted: false,
  };
}

export function orderLifecycleActions(order: Pick<OperationalOrderRecord, "id" | "type" | "status">): {
  eliminar: LifecycleDecision;
  anular: LifecycleDecision;
  archivar: LifecycleDecision;
  restaurar: LifecycleDecision;
} {
  const state = orderToLifecycleState(order);
  return {
    eliminar: canDelete(state),
    anular: canAnnul(state),
    archivar: canArchive(state),
    restaurar: canRestore(state),
  };
}
