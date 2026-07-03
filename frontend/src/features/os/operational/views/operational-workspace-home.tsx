"use client";

import { usePreviewSession } from "@/features/os/session/preview-context";
import { CalidadOperationalView } from "./calidad-operational-view";
import {
  ElaboracionOperationalView,
  EnvasadoOperationalView,
} from "./envasado-operational-view";
import { ProduccionOperationalView } from "./produccion-operational-view";
import { PremiumWorkspaceHome } from "@/features/os/workspace/components/premium/premium-workspace-home";

/**
 * Home operativa de /mi-trabajo — tablas tipo Sheets, filtrada por sector/persona.
 * Sectores sin vista operativa aún usan fallback premium (Depósito, Dirección).
 */
export function OperationalWorkspaceHome() {
  const { sectorId } = usePreviewSession();

  switch (sectorId) {
    case "ENVASADO_MASIVO":
      return <EnvasadoOperationalView sectorId="ENVASADO_MASIVO" />;
    case "ENVASADO_PREMIUM":
      return <EnvasadoOperationalView sectorId="ENVASADO_PREMIUM" />;
    case "ELABORACION":
      return <ElaboracionOperationalView />;
    case "CALIDAD":
      return <CalidadOperationalView />;
    case "PRODUCCION":
      return <ProduccionOperationalView />;
    default:
      return <PremiumWorkspaceHome />;
  }
}
