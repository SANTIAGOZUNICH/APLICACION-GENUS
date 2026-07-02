"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { SectorSelector } from "@/components/operational/sector-selector";
import { MiTrabajoSections } from "@/components/operational/work-item-sections";
import { fetchWorkItems, OperationsApiError } from "@/lib/api/operations-client";
import { useCurrentSector } from "@/lib/operational/current-sector-context";
import { partitionMiTrabajoSections } from "@/lib/operational/work-item-filters";
import { getClientDataMode } from "@/lib/config/data-mode";
import type { WorkItemsResponse } from "@/types/operational/work-item";

/** F8.1 — /mi-trabajo consumes WorkItems only (no OE/OA/Pedido/Lote lists). */
export function MiTrabajoView() {
  const { sector, greeting } = useCurrentSector();
  const dataMode = getClientDataMode();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<WorkItemsResponse | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const data = await fetchWorkItems(sector);
        if (active) {
          setResponse(data);
        }
      } catch (err) {
        if (active) {
          setResponse(null);
          setError(
            err instanceof OperationsApiError
              ? err.message
              : "No se pudieron cargar WorkItems."
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [sector]);

  const items = response?.workItems ?? [];
  const sections = partitionMiTrabajoSections(items);
  const isEmpty = !loading && !error && items.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <SectorSelector />

      <div>
        <h2 className="text-lg font-semibold">Hola {greeting}</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Trabajo operativo desde SEMANAS 2026 · sector {sector}
        </p>
      </div>

      {dataMode === "demo" && (
        <Alert variant="info" title="Modo demo">
          WorkItems reales requieren{" "}
          <code className="text-xs">GENUS_DATA_MODE=real</code>. No se muestran mocks.
        </Alert>
      )}

      {response?.message && (
        <Alert variant={items.length > 0 ? "ok" : "info"} title="Origen de datos">
          {response.message}
        </Alert>
      )}

      {loading && (
        <div className="flex items-center gap-2 py-8 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Cargando WorkItems…
        </div>
      )}

      {error && !loading && (
        <Alert variant="problem" title="Error">
          {error}
        </Alert>
      )}

      {isEmpty && (
        <Alert variant="info" title="Sin trabajos">
          No hay trabajos asignados para este sector.
        </Alert>
      )}

      {!loading && !error && items.length > 0 && (
        <MiTrabajoSections
          hoy={sections.hoy}
          semana={sections.semana}
          pendientes={sections.pendientes}
          bloqueados={sections.bloqueados}
        />
      )}
    </div>
  );
}
