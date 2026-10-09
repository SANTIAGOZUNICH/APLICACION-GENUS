"use client";

/**
 * Editor de planificación de UN trabajo (Producción), para usar dentro del detalle: la MISMA tarjeta editable de
 * «Mi trabajo» (mismos campos, misma API PATCH /api/v1/work-items/cells, versión, motivo y auditoría).
 * Lee el trabajo FRESCO del servidor al abrir y después de cada guardado, así nunca edita sobre una versión vieja.
 * Para cualquier otro sector no renderiza nada (sus permisos operativos no cambian).
 */
import { useCallback, useEffect, useState } from "react";
import { fetchWorkItemById } from "@/lib/api/live-sync-client";
import { isNativeWorkItemId } from "@/lib/planning/work-item-cell-edit";
import type { WorkItem } from "@/types/operational/work-item";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { useWorkItemCellEditing } from "../hooks/use-work-item-cells";
import { WorkItemCards } from "./work-item-cards";

export function WorkItemPlanEditor({ item, variant, onChanged }: { item: WorkItem; variant: "envasado" | "elaboracion"; onChanged?: () => void | Promise<void> }) {
  const { sectorId } = usePreviewSession();
  const enabled = sectorId === "PRODUCCION" && isNativeWorkItemId(item.id);
  const [fresh, setFresh] = useState<WorkItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetchWorkItemById(item.id);
      setFresh({ ...r.item, version: r.version });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el trabajo.");
    }
  }, [item.id]);
  useEffect(() => {
    if (!enabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [enabled, load]);

  const current = fresh ?? item;
  const cells = useWorkItemCellEditing([current], async () => {
    await load();
    await onChanged?.();
  });
  if (!enabled) return null;
  return (
    <section className="space-y-2" data-testid="work-item-plan-editor">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--os-teal)]">Planificación · tocá un dato para editarlo</h3>
      {error && <p className="text-xs text-red-300" role="alert">{error}</p>}
      <WorkItemCards
        items={[current]}
        variant={variant}
        cells={cells}
        hideActions
        showPackagingColumns={variant === "envasado"}
        getFinishedQty={() => current.finishedQty ?? ""}
        // La proyección usa la observación de planificación como respaldo del avance: no se muestra dos veces.
        getObservation={() => (current.operationalObservation && current.operationalObservation !== current.notes ? current.operationalObservation : "")}
        onSelectItem={() => undefined}
      />
    </section>
  );
}
