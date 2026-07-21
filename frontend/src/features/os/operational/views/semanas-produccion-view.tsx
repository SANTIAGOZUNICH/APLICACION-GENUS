"use client";

import { useMemo, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { WireframePlanSemanal } from "@/features/work/views/plan-semanal";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { canWriteInventory } from "@/lib/inventory/rbac";
import type { SectorId } from "@/types/operational/sector";

const TABS: { id: SectorId; label: string }[] = [
  { id: "ELABORACION", label: "Elaboración" },
  { id: "ENVASADO_MASIVO", label: "Envasado Masivo" },
  { id: "ENVASADO_PREMIUM", label: "Envasado Premium" },
];

/**
 * Semanas de Producción para DEPOSITO — solo lectura.
 * La mutación de planning ya está gated por assertProduccionActor en API.
 */
export function SemanasProduccionView() {
  const { sectorId } = usePreviewSession();
  const [tab, setTab] = useState<SectorId>("ELABORACION");
  const readOnly = !canWriteInventory(sectorId, "semanas_ro");

  const banner = useMemo(
    () =>
      readOnly
        ? "Solo lectura: no podés crear, editar, eliminar trabajos, cambiar fechas, cantidades, avances, finalizar ni aprobar/rechazar."
        : null,
    [readOnly]
  );

  return (
    <div className="space-y-0">
      {banner && (
        <div className="mx-auto max-w-[var(--os-content-max,1200px)] px-4 pt-4 md:px-6">
          <div className="rounded border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
            Semanas de Producción — {banner}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`rounded px-3 py-1.5 text-sm ${
                  tab === t.id
                    ? "bg-[var(--os-teal)] text-white"
                    : "border border-[var(--os-border)]"
                }`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-[var(--os-text-muted)]">
            Vista consultiva del plan ({TABS.find((t) => t.id === tab)?.label}). Las acciones de
            escritura están bloqueadas en UI, store y API para DEPOSITO.
          </p>
        </div>
      )}
      {/* Plan semanal reutiliza WorkItems; sin botones de mutación en este wireframe. */}
      <div className={readOnly ? "pointer-events-none select-none opacity-95" : undefined}>
        <WireframePlanSemanal />
      </div>
      {readOnly && (
        <TwinShell title="Acciones bloqueadas">
          <p className="text-sm text-[var(--os-text-muted)]">
            Intentar mutar semanas vía API con sector DEPOSITO responde 403 (assertCanMutateSemanas /
            assertProduccionActor).
          </p>
        </TwinShell>
      )}
    </div>
  );
}
