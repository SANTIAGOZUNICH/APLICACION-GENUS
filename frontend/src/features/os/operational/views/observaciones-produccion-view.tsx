"use client";

import { TwinShell } from "@/features/os/shell/twin-shell";

/** Producción: observaciones de las entregas — en construcción (andamiaje de navegación). */
export function ObservacionesProduccionView() {
  return (
    <TwinShell title="Observaciones">
      <h2 className="text-2xl font-semibold tracking-tight">Observaciones</h2>
      <p className="mt-2 text-sm text-[var(--os-text-muted)]" data-testid="observaciones-stub">Próximamente.</p>
    </TwinShell>
  );
}
