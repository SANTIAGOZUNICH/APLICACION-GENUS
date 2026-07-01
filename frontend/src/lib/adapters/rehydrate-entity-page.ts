import { ScanBarcode } from "lucide-react";
import { EntityPageKinds, type EntityPageModel } from "@/types/entity-page";
import type { EntityPageModelDTO } from "@/lib/api/operations-client";

const IDENTITY_ICONS = {
  [EntityPageKinds.LOTE]: ScanBarcode,
} as const;

export function rehydrateEntityPage(dto: EntityPageModelDTO): EntityPageModel {
  const identityIcon =
    dto.kind === EntityPageKinds.LOTE ? IDENTITY_ICONS[EntityPageKinds.LOTE] : undefined;

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
