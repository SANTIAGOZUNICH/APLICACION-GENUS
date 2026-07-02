"use client";

import type { PreviewScreenId } from "@/design-preview/config";
import { PREVIEW_SCREENS } from "@/design-preview/config";
import {
  isRoleEngineScreen,
  SECTOR_VIEW_REGISTRY,
  sectorIdForPreviewScreen,
} from "@/design-preview/sector-view-registry";
import { WireframeArchitecture } from "@/design-preview/wireframes/architecture";
import { WireframeConsulta } from "@/design-preview/wireframes/consulta";
import { WireframePlanSemanal } from "@/design-preview/wireframes/plan-semanal";
import { renderSectorHome } from "@/lib/role-engine";

const UTILITY_WIREFRAMES = {
  architecture: WireframeArchitecture,
  "plan-semanal": WireframePlanSemanal,
  consulta: WireframeConsulta,
} as const;

interface DesignPreviewCanvasProps {
  screenId: PreviewScreenId;
}

export function DesignPreviewCanvas({ screenId }: DesignPreviewCanvasProps) {
  const meta = PREVIEW_SCREENS.find((s) => s.id === screenId);

  if (!meta) return null;

  if (screenId in UTILITY_WIREFRAMES) {
    const Utility = UTILITY_WIREFRAMES[screenId as keyof typeof UTILITY_WIREFRAMES];
    return <Utility />;
  }

  if (isRoleEngineScreen(screenId)) {
    const sectorId = sectorIdForPreviewScreen(screenId);
    if (sectorId) {
      return renderSectorHome(sectorId, SECTOR_VIEW_REGISTRY);
    }
  }

  return null;
}

export { PREVIEW_SCREENS };
