"use client";

import { TwinShell } from "@/features/os/shell/twin-shell";
import { RetiroWizard } from "@/features/os/operational/components/insumos/retiro-wizard";

/** Pestaña INSUMOS de los sectores operativos: retiro de insumos en 3 pasos (mobile-first). */
export function InsumosView() {
  return (
    <TwinShell title="Insumos">
      <header className="mb-4">
        <h2 className="text-2xl font-semibold tracking-tight">INSUMOS</h2>
        <p className="text-sm text-[var(--os-text-muted)]">Registrá lo que retirás: elegí las cantidades, quién retiró y confirmá. Solo registra consumo (no mueve stock).</p>
      </header>
      <RetiroWizard />
    </TwinShell>
  );
}
