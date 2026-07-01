import { Factory, Package, ScanBarcode, ShieldCheck, Truck } from "lucide-react";
import { EntityPageKinds, type EntityPageModel } from "@/types/entity-page";
import type { EntityPageModelDTO } from "@/lib/api/operations-client";

const IDENTITY_ICONS = {
  [EntityPageKinds.OE]: Factory,
  [EntityPageKinds.OA]: Package,
  [EntityPageKinds.LOTE]: ScanBarcode,
  [EntityPageKinds.PEDIDO]: Truck,
  [EntityPageKinds.LIBERACION]: ShieldCheck,
} as const;

export function rehydrateEntityPage(dto: EntityPageModelDTO): EntityPageModel {
  const identityIcon = IDENTITY_ICONS[dto.kind];

  return {
    ...dto,
    identityIcon,
  };
}

export function stripEntityPageIcon(model: EntityPageModel): EntityPageModelDTO {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- icon is client-only
  const { identityIcon, ...rest } = model;
  return rest;
}
