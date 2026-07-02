"use client";

import type { ComponentType } from "react";
import type { PreviewScreenId } from "@/design-preview/config";
import { PREVIEW_SCREENS } from "@/design-preview/config";
import { WireframeArchitecture } from "@/design-preview/wireframes/architecture";
import { WireframeCalidad } from "@/design-preview/wireframes/calidad";
import { WireframeConsulta } from "@/design-preview/wireframes/consulta";
import { WireframeDeposito } from "@/design-preview/wireframes/deposito";
import { WireframeDireccion } from "@/design-preview/wireframes/direccion";
import { WireframeElaboracion } from "@/design-preview/wireframes/elaboracion";
import { WireframeEnvasadoMasivo } from "@/design-preview/wireframes/envasado-masivo";
import { WireframeEnvasadoPremium } from "@/design-preview/wireframes/envasado-premium";
import { WireframePlanSemanal } from "@/design-preview/wireframes/plan-semanal";
import { WireframeProduccion } from "@/design-preview/wireframes/produccion";

const WIREFRAMES: Record<PreviewScreenId, ComponentType> = {
  architecture: WireframeArchitecture,
  "envasado-masivo": WireframeEnvasadoMasivo,
  "envasado-premium": WireframeEnvasadoPremium,
  elaboracion: WireframeElaboracion,
  calidad: WireframeCalidad,
  deposito: WireframeDeposito,
  produccion: WireframeProduccion,
  direccion: WireframeDireccion,
  "plan-semanal": WireframePlanSemanal,
  consulta: WireframeConsulta,
};

interface DesignPreviewCanvasProps {
  screenId: PreviewScreenId;
}

export function DesignPreviewCanvas({ screenId }: DesignPreviewCanvasProps) {
  const meta = PREVIEW_SCREENS.find((s) => s.id === screenId);
  const Wireframe = WIREFRAMES[screenId];

  if (!meta || !Wireframe) return null;

  if (screenId === "architecture") {
    return <WireframeArchitecture />;
  }

  return <Wireframe />;
}

export { PREVIEW_SCREENS };
