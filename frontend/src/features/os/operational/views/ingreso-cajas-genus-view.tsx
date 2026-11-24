"use client";

import { TwinShell } from "@/features/os/shell/twin-shell";

/** Depósito: ingreso de cajas Genus — en construcción (andamiaje de navegación). */
export function IngresoCajasGenusView() {
  return (
    <TwinShell title="Ingreso de Cajas Genus">
      <h2 className="text-2xl font-semibold tracking-tight">Ingreso de Cajas Genus</h2>
      <p className="mt-2 text-sm text-[var(--os-text-muted)]" data-testid="ingreso-cajas-stub">Próximamente.</p>
    </TwinShell>
  );
}
