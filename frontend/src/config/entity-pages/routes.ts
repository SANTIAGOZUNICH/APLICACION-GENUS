import { EntityPageKinds, type EntityPageKind } from "@/types/entity-page";

const ROUTE_BASE: Record<EntityPageKind, string> = {
  [EntityPageKinds.OE]: "/oe",
  [EntityPageKinds.OA]: "/oa",
  [EntityPageKinds.LOTE]: "/lote",
  [EntityPageKinds.PEDIDO]: "/pedido",
  [EntityPageKinds.LIBERACION]: "/liberacion",
};

/** Build href for cross-entity navigation. */
export function entityPageHref(kind: EntityPageKind, entityId: string): string {
  return `${ROUTE_BASE[kind]}/${encodeURIComponent(entityId)}`;
}

export function oePageHref(oeId: string): string {
  return entityPageHref(EntityPageKinds.OE, oeId);
}

export function oaPageHref(oaId: string): string {
  return entityPageHref(EntityPageKinds.OA, oaId);
}

export function lotePageHref(loteNumber: string): string {
  return entityPageHref(EntityPageKinds.LOTE, loteNumber);
}

export function pedidoPageHref(pedidoId: string): string {
  return entityPageHref(EntityPageKinds.PEDIDO, pedidoId);
}

export function liberacionPageHref(liberacionId: string): string {
  return entityPageHref(EntityPageKinds.LIBERACION, liberacionId);
}
