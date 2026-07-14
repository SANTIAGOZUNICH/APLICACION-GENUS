"use client";

import { useState } from "react";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { getClientPlanningSource } from "@/lib/planning/planning-source";
import { CalidadOperationalView } from "./calidad-operational-view";
import { DepositoOperationalView } from "./deposito-operational-view";
import {
  ElaboracionOperationalView,
  EnvasadoOperationalView,
} from "./envasado-operational-view";
import { ProduccionOperationalView } from "./produccion-operational-view";
import { ProduccionPlanningView } from "./produccion-planning-view";

/**
 * Home operativa de /mi-trabajo — tablas tipo Sheets, filtrada por sector.
 */
export function OperationalWorkspaceHome() {
  const { sectorId } = usePreviewSession();
  const nativePlanning = getClientPlanningSource() === "native";
  const [prodTab, setProdTab] = useState<"planificacion" | "tablero">(
    nativePlanning ? "planificacion" : "tablero"
  );

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
      if (!nativePlanning) return <ProduccionOperationalView />;
      return (
        <div>
          <div className="mb-4 flex gap-2 px-1">
            <button
              type="button"
              className={`rounded px-3 py-1.5 text-sm ${prodTab === "planificacion" ? "bg-[var(--os-teal)] text-white" : "border border-[var(--os-border)]"}`}
              onClick={() => setProdTab("planificacion")}
            >
              Planificación
            </button>
            <button
              type="button"
              className={`rounded px-3 py-1.5 text-sm ${prodTab === "tablero" ? "bg-[var(--os-teal)] text-white" : "border border-[var(--os-border)]"}`}
              onClick={() => setProdTab("tablero")}
            >
              Tablero
            </button>
          </div>
          {prodTab === "planificacion" ? (
            <ProduccionPlanningView />
          ) : (
            <ProduccionOperationalView />
          )}
        </div>
      );
    case "DIRECCION":
      return <ProduccionOperationalView />;
    case "DEPOSITO":
      return <DepositoOperationalView />;
    default:
      return <DepositoOperationalView />;
  }
}
