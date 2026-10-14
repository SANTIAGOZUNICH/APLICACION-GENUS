"use client";

import { usePreviewSession } from "@/features/os/session/preview-context";
import { HistorialView } from "./historial-view";
import { historialSectorsForActor } from "@/features/os/navigation/twin-nav";
import { DepositoOperationalView } from "./deposito-operational-view";
import {
  ElaboracionOperationalView,
  EnvasadoOperationalView,
} from "./envasado-operational-view";
import { MpHubView } from "./mp-hub-view";
import { ProduccionOperationalView } from "./produccion-operational-view";
import { ProduccionPanelView } from "./produccion-panel-view";
import { CodificadoOperationalView } from "./codificado-operational-view";

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
      return <CodificadoOperationalView />;
    case "CALIDAD":
      // Calidad salió del circuito operativo: las cuentas del sector siguen vigentes y entran a una vista de SOLO
      // LECTURA con el historial (incluye las decisiones históricas de Calidad). Sin acciones ni aprobaciones.
      return <HistorialView sectors={historialSectorsForActor("PRODUCCION")} title="Historial" />;
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
