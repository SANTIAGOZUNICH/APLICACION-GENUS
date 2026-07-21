import type { SectorId } from "@/types/operational/sector";
import type { OrderDocType, OrdersActor } from "@/lib/orders/types";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";

export type OrderAction =
  | "create"
  | "view"
  | "edit"
  | "edit_formula"
  | "save_progress"
  | "deliver"
  | "save_as_master"
  | "propose_master"
  | "approve_master"
  | "manage_templates"
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

const TEMPLATE_MANAGERS: readonly OrderAction[] = [
  "create",
  "view",
  "edit",
  "edit_formula",
  "save_progress",
  "review",
  "return",
  "archive",
  "annul",
  "download",
  "save_as_master",
  "approve_master",
  "manage_templates",
];

const OE_ACTIONS: Partial<Record<SectorId, readonly OrderAction[]>> = {
  CALIDAD: TEMPLATE_MANAGERS,
  PRODUCCION: TEMPLATE_MANAGERS,
  DIRECCION: TEMPLATE_MANAGERS,
  ELABORACION: [
    "view",
    "edit",
    "save_progress",
    "deliver",
    "propose_master",
    "download",
  ],
  /** MP puede corregir/proponer fórmula teórica; no aprueba maestra ni entrega. */
  MATERIA_PRIMA: ["view", "download", "edit_formula", "save_progress", "propose_master"],
};

const OA_ACTIONS: Partial<Record<SectorId, readonly OrderAction[]>> = {
  CALIDAD: TEMPLATE_MANAGERS,
  PRODUCCION: TEMPLATE_MANAGERS,
  DIRECCION: TEMPLATE_MANAGERS,
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
  CODIFICADO: ["view", "edit_codificado", "download", "save_progress"],
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

/** Campos de fórmula teórica OE. */
export type OeFormulaField =
  | "materiaPrima"
  | "codigo"
  | "formulaPct"
  | "kgAPesar"
  | "addMaterial"
  | "removeMaterial"
  | "procedure"
  | "specs";

/** Campos operativos de elaboración. */
export type OeOperationalField = "ajuste" | "ajusteMotivo" | "lote" | "headerOps" | "results";

export function canEditOeFormula(sectorId: SectorId | null | undefined): boolean {
  return canOrderAction("OE", "edit_formula", sectorId);
}

export function canEditOeOperational(sectorId: SectorId | null | undefined): boolean {
  return canOrderAction("OE", "edit", sectorId);
}

export function canApproveMasterVersion(sectorId: SectorId | null | undefined): boolean {
  return (
    sectorId === "CALIDAD" || sectorId === "PRODUCCION" || sectorId === "DIRECCION"
  );
}
