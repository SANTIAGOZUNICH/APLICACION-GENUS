import type { SectorId } from "@/types/operational/sector";
import type { OrderDocType, OrdersActor } from "@/lib/orders/types";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";

export type OrderAction =
  | "create"
  | "view"
  | "edit"
  | "save_progress"
  | "deliver"
  | "save_as_master"
  | "propose_master"
  | "approve_master"
  | "review"
  | "return"
  | "archive"
  | "annul"
  | "download"
  | "edit_codificado";

export const ORDERS_DENIED_MESSAGE =
  "Tu sector no tiene permiso para realizar esta acción sobre la orden.";

export const ORDERS_MISSING_ACTOR_MESSAGE =
  "Falta actorSectorId. Las acciones sobre órdenes requieren sector autenticado.";

const OE_ACTIONS: Partial<Record<SectorId, readonly OrderAction[]>> = {
  CALIDAD: [
    "create",
    "view",
    "review",
    "return",
    "archive",
    "annul",
    "download",
    "save_as_master",
    "approve_master",
  ],
  PRODUCCION: [
    "create",
    "view",
    "review",
    "return",
    "archive",
    "annul",
    "download",
    "save_as_master",
    "approve_master",
  ],
  DIRECCION: [
    "create",
    "view",
    "review",
    "return",
    "archive",
    "annul",
    "download",
    "save_as_master",
    "approve_master",
  ],
  ELABORACION: [
    "view",
    "edit",
    "save_progress",
    "deliver",
    "propose_master",
    "download",
  ],
  MATERIA_PRIMA: ["view", "download"],
};

const OA_ACTIONS: Partial<Record<SectorId, readonly OrderAction[]>> = {
  CALIDAD: [
    "create",
    "view",
    "review",
    "return",
    "archive",
    "annul",
    "download",
    "save_as_master",
    "approve_master",
  ],
  PRODUCCION: [
    "create",
    "view",
    "review",
    "return",
    "archive",
    "annul",
    "download",
    "save_as_master",
    "approve_master",
  ],
  DIRECCION: [
    "create",
    "view",
    "review",
    "return",
    "archive",
    "annul",
    "download",
    "save_as_master",
    "approve_master",
  ],
  ENVASADO_MASIVO: [
    "view",
    "edit",
    "save_progress",
    "deliver",
    "propose_master",
    "download",
  ],
  ENVASADO_PREMIUM: [
    "view",
    "edit",
    "save_progress",
    "deliver",
    "propose_master",
    "download",
  ],
  CODIFICADO: ["view", "edit_codificado", "download"],
};

export function canOrderAction(
  type: OrderDocType,
  action: OrderAction,
  sectorId: SectorId | null | undefined
): boolean {
  if (!sectorId) return false;
  const map = type === "OE" ? OE_ACTIONS : OA_ACTIONS;
  return map[sectorId]?.includes(action) ?? false;
}

export function assertCanOrderAction(
  type: OrderDocType,
  action: OrderAction,
  actor: OrdersActor | null | undefined
): void {
  if (!actor?.sector) {
    throw new OrdersValidationError(ORDERS_MISSING_ACTOR_MESSAGE);
  }
  if (!canOrderAction(type, action, actor.sector)) {
    throw new OrdersForbiddenError(ORDERS_DENIED_MESSAGE);
  }
}

/** Emasivo/Epremium solo editan OA de su propio sector asignado. */
export function assertCanAccessAssignedOrder(
  type: OrderDocType,
  assignedSector: SectorId,
  actor: OrdersActor,
  action: OrderAction
): void {
  assertCanOrderAction(type, action, actor);
  if (type === "OA") {
    if (
      (actor.sector === "ENVASADO_MASIVO" || actor.sector === "ENVASADO_PREMIUM") &&
      assignedSector !== actor.sector
    ) {
      throw new OrdersForbiddenError(
        "Solo podés editar u operar OA asignadas a tu sector (Masivo/Premium)."
      );
    }
  }
  if (type === "OE" && action === "edit" && actor.sector !== "ELABORACION") {
    // create/review sectors already gated above
  }
}

export type OrderActionGate =
  | { ok: true }
  | {
      ok: false;
      error: string;
      code: "ORDERS_FORBIDDEN" | "ORDERS_MISSING_ACTOR";
    };

export function gateOrderAction(
  type: OrderDocType,
  action: OrderAction,
  sectorId: SectorId | null | undefined
): OrderActionGate {
  if (!sectorId) {
    return {
      ok: false,
      error: ORDERS_MISSING_ACTOR_MESSAGE,
      code: "ORDERS_MISSING_ACTOR",
    };
  }
  if (!canOrderAction(type, action, sectorId)) {
    return { ok: false, error: ORDERS_DENIED_MESSAGE, code: "ORDERS_FORBIDDEN" };
  }
  return { ok: true };
}
