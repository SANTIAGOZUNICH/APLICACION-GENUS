"use client";

import { TwinShell } from "@/features/os/shell/twin-shell";

/** Retiro de insumos del sector — en construcción (andamiaje de navegación). */
export function InsumosView() {
  return (
    <TwinShell title="Insumos">
      <h2 className="text-2xl font-semibold tracking-tight">Insumos</h2>
      <p className="mt-2 text-sm text-[var(--os-text-muted)]" data-testid="insumos-stub">Próximamente.</p>
    </TwinShell>
  );
}
