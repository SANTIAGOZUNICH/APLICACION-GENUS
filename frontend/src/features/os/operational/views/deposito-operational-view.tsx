"use client";

import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import { SECTOR_PERSONNEL } from "../lib/sector-personnel";

/** Depósito — pendiente de modelado operativo; estado honesto sin datos inventados. */
export function DepositoOperationalView() {
  const workspace = useRequiredWorkspace();

  return (
    <TwinShell title="Depósito">
      <header className="mb-6 space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Depósito</h2>
        <p className="text-sm text-[var(--os-text-muted)]">
          Responsable:{" "}
          <span className="font-medium text-[var(--os-text)]">
            {SECTOR_PERSONNEL.DEPOSITO}
          </span>
        </p>
      </header>

      <div className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] px-6 py-10">
        <p className="text-lg font-semibold text-[var(--os-text)]">
          Vista de Depósito en preparación
        </p>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-[var(--os-text-muted)]">
          Este sector todavía no tiene flujo operativo modelado sobre SEMANAS / LOTES. La Beta
          Operativa no inventa movimientos de stock aquí.{" "}
          {workspace.context.displayName
            ? `Sesión activa: ${workspace.context.displayName}.`
            : null}
        </p>
      </div>
    </TwinShell>
  );
}
