"use client";

import { TwinShell } from "@/features/os/shell/twin-shell";
import { UbicacionesWorkspace } from "../components/ubicaciones/ubicaciones-workspace";

/**
 * Depósito › UBICACIONES (`mode="deposito"`: asigna, mueve, libera; Depósito y Dirección configuran el mapa) y
 * Envasado › UBICACIÓN DE MATERIALES (`mode="consulta"`: el mismo mapa y buscador, solo lectura).
 */
export function UbicacionesView({ mode }: { mode: "deposito" | "consulta" }) {
  return (
    <TwinShell title={mode === "deposito" ? "Ubicaciones" : "Ubicación de materiales"}>
      <UbicacionesWorkspace mode={mode} />
    </TwinShell>
  );
}
