"use client";

import { TwinShell } from "@/features/os/shell/twin-shell";
import { UbicacionesWorkspace } from "../components/ubicaciones/ubicaciones-workspace";

/**
 * UBICACIONES: pestaña única para TODOS los sectores. Todos consultan el mapa completo (solo lectura); solo Depósito modifica contenido y clientes
 * (lo decide el servidor: `capabilities`), y Depósito/Dirección configuran el mapa.
 */
export function UbicacionesView() {
  return (
    <TwinShell title="Ubicaciones">
      <UbicacionesWorkspace />
    </TwinShell>
  );
}
