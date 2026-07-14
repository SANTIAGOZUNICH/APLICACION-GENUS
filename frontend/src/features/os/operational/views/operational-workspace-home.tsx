"use client";

import { usePreviewSession } from "@/features/os/session/preview-context";
import { CalidadOperationalView } from "./calidad-operational-view";
import { DepositoOperationalView } from "./deposito-operational-view";
import {
  ElaboracionOperationalView,
  EnvasadoOperationalView,
} from "./envasado-operational-view";
import { ProduccionOperationalView } from "./produccion-operational-view";

/**
 * Home operativa de /mi-trabajo — tablas tipo Sheets, filtrada por sector.
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
    case "DIRECCION":
      return <ProduccionOperationalView />;
    case "DEPOSITO":
      return <DepositoOperationalView />;
    default:
      return <DepositoOperationalView />;
  }
}
