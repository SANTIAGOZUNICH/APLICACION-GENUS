"use client";

import { usePreviewSession } from "@/features/os/session/preview-context";
import { CalidadOperationalView } from "./calidad-operational-view";
import { DepositoOperationalView } from "./deposito-operational-view";
import {
  ElaboracionOperationalView,
  EnvasadoOperationalView,
} from "./envasado-operational-view";
import { MateriaPrimaStockView } from "./materia-prima-stock-view";
import { ProduccionOperationalView } from "./produccion-operational-view";
import { ProduccionPanelView } from "./produccion-panel-view";

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
    case "CALIDAD":
      return <CalidadOperationalView />;
    case "MATERIA_PRIMA":
      return <MateriaPrimaStockView />;
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
