"use client";

import { usePreviewSession } from "@/features/os/session/preview-context";
import { CalidadOperationalView } from "./calidad-operational-view";
import { DepositoOperationalView } from "./deposito-operational-view";
import {
  ElaboracionOperationalView,
  EnvasadoOperationalView,
} from "./envasado-operational-view";
import { MpHubView } from "./mp-hub-view";
import { ProduccionOperationalView } from "./produccion-operational-view";
import { ProduccionPanelView } from "./produccion-panel-view";
import { AsignacionLotesView } from "./asignacion-lotes-view";

/**
 * Home operativa de /mi-trabajo — filtrada por sector.
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
    case "CODIFICADO":
      return <AsignacionLotesView />;
    case "CALIDAD":
      return <CalidadOperationalView />;
    case "MATERIA_PRIMA":
      return <MpHubView initialTab="Stock" />;
    case "PRODUCCION":
      return <ProduccionPanelView />;
    case "DIRECCION":
      return <ProduccionOperationalView />;
    case "DEPOSITO":
      return <DepositoOperationalView />;
    default:
      return <DepositoOperationalView />;
  }
}
