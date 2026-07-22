"use client";

import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import { usePreviewContext } from "@/features/os/session/preview-context";
import { SECTOR_PERSONNEL } from "../lib/sector-personnel";
import { Button } from "@/components/ui/button";

/** Home DEPOSITO — acceso a Ingresos ME / Salidas ME / Avisos / Semanas. */
export function DepositoOperationalView() {
  const workspace = useRequiredWorkspace();
  const { navigateSidebar } = usePreviewContext();

  return (
    <TwinShell title="Depósito">
      <header className="mb-6 space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Depósito</h2>
        <p className="text-sm text-[var(--os-text-muted)]">
          Responsable:{" "}
          <span className="font-medium text-[var(--os-text)]">{SECTOR_PERSONNEL.DEPOSITO}</span>
          {" · "}
          Credencial temporal demo (deposito@ / deposito123)
        </p>
        <p className="text-sm text-[var(--os-text-muted)]">
          {workspace.context.displayName
            ? `Sesión: ${workspace.context.displayName}.`
            : null}{" "}
          Tablas ME vacías — sin importar históricos de Excel. Persistencia Neon.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => navigateSidebar("ingresos_me")}>
          Ingresos ME
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => navigateSidebar("salidas_me")}
        >
          Salidas ME
        </Button>
        <Button type="button" variant="secondary" onClick={() => navigateSidebar("avisos_me")}>
          Avisos
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => navigateSidebar("semanas_produccion")}
        >
          Semanas de Producción
        </Button>
      </div>
    </TwinShell>
  );
}
