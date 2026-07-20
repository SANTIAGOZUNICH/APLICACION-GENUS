import type { SectorId } from "@/types/operational/sector";

export type OrderDocumentKind = "OE" | "OA";
export type OrderDocAction = "view" | "download" | "upload" | "replace";

export const ORDER_DOCUMENT_DENIED_MESSAGE =
  "Tu sector no tiene permiso para realizar esta acción sobre el documento.";

export const ORDER_DOCUMENT_MISSING_ACTOR_MESSAGE =
  "Falta actorSectorId. Las acciones sobre documentos requieren sector autenticado.";

const OE_PERMISSIONS: Partial<Record<SectorId, readonly OrderDocAction[]>> = {
  ELABORACION: ["view", "download"],
  PRODUCCION: ["view", "download", "upload", "replace"],
  CALIDAD: ["view", "download", "upload", "replace"],
  MATERIA_PRIMA: ["view", "download", "upload", "replace"],
};

const OA_PERMISSIONS: Partial<Record<SectorId, readonly OrderDocAction[]>> = {
  ENVASADO_MASIVO: ["view", "download"],
  ENVASADO_PREMIUM: ["view", "download"],
  PRODUCCION: ["view", "download", "upload", "replace"],
  CALIDAD: ["view", "download", "upload", "replace"],
};

export function canOrderDocumentAction(
  kind: OrderDocumentKind,
  action: OrderDocAction,
  sectorId: SectorId
): boolean {
  const permissions = kind === "OE" ? OE_PERMISSIONS : OA_PERMISSIONS;
  return permissions[sectorId]?.includes(action) ?? false;
}

export function assertCanOrderDocumentAction(
  kind: OrderDocumentKind,
  action: OrderDocAction,
  sectorId: SectorId | null | undefined
): void {
  if (!sectorId) {
    throw new Error(ORDER_DOCUMENT_MISSING_ACTOR_MESSAGE);
  }
  if (!canOrderDocumentAction(kind, action, sectorId)) {
    throw new Error(ORDER_DOCUMENT_DENIED_MESSAGE);
  }
}

export type OrderDocumentActionGate =
  | { ok: true }
  | { ok: false; error: string; code: "ORDER_DOCUMENT_FORBIDDEN" | "ORDER_DOCUMENT_MISSING_ACTOR" };

export function gateOrderDocumentAction(
  kind: OrderDocumentKind,
  action: OrderDocAction,
  sectorId: SectorId | null | undefined
): OrderDocumentActionGate {
  if (!sectorId) {
    return {
      ok: false,
      error: ORDER_DOCUMENT_MISSING_ACTOR_MESSAGE,
      code: "ORDER_DOCUMENT_MISSING_ACTOR",
    };
  }
  if (!canOrderDocumentAction(kind, action, sectorId)) {
    return {
      ok: false,
      error: ORDER_DOCUMENT_DENIED_MESSAGE,
      code: "ORDER_DOCUMENT_FORBIDDEN",
    };
  }
  return { ok: true };
}
