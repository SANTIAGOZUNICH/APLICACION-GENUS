"use client";

import { EntityPageLoader } from "@/components/data/entity-page-loader";
import { EntityPageKinds } from "@/types/entity-page";

interface LotePageLoaderProps {
  entityId: string;
}

/** @deprecated Use EntityPageLoader — kept for E7 compatibility. */
export function LotePageLoader({ entityId }: LotePageLoaderProps) {
  return <EntityPageLoader kind={EntityPageKinds.LOTE} entityId={entityId} />;
}
