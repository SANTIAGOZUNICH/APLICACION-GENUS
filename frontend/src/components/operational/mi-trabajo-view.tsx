"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { SectorSelector } from "@/components/operational/sector-selector";
import { SectorQuickSwitch } from "@/components/operational/sector-quick-switch";
import { MiTrabajoPreviewPanel } from "@/components/operational/mi-trabajo-preview-panel";
import { MiTrabajoSections } from "@/components/operational/work-item-sections";
import {
  fetchWorkItemsPreview,
  OperationsApiError,
} from "@/lib/api/operations-client";
import { useCurrentSector } from "@/lib/operational/current-sector-context";
import { getClientDataMode } from "@/lib/config/data-mode";
import type { WorkItemsPreviewResponse } from "@/types/operational/work-items-preview.types";

/** F8.1 — /mi-trabajo preview: WorkItems + validation panels per sector. */
export function MiTrabajoView() {
  const { sector, greeting } = useCurrentSector();
  const dataMode = getClientDataMode();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<WorkItemsPreviewResponse | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const data = await fetchWorkItemsPreview(sector);
        if (active) {
          setPreview(data);
        }
      } catch (err) {
        if (active) {
          setPreview(null);
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

  const items = preview?.workItems ?? [];
  const sections = preview?.sections;
  const isEmpty = !loading && !error && items.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          Preview F8.1
        </p>
        <h2 className="mt-1 text-lg font-semibold">Hola {greeting}</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Validación funcional del modelo operativo · sector {sector}
        </p>
        <div className="mt-4">
          <SectorQuickSwitch />
        </div>
      </div>

      <SectorSelector />

      {dataMode === "demo" && (
        <Alert variant="info" title="Modo demo">
          WorkItems reales requieren{" "}
          <code className="text-xs">GENUS_DATA_MODE=real</code>. No se muestran mocks.
        </Alert>
      )}

      {preview?.message && (
        <Alert variant={items.length > 0 ? "ok" : "info"} title="Origen de datos">
          {preview.message}
        </Alert>
      )}

      {loading && (
        <div className="flex items-center gap-2 py-8 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Cargando preview operativo…
        </div>
      )}

      {error && !loading && (
        <Alert variant="problem" title="Error">
          {error}
        </Alert>
      )}

      {!loading && preview && <MiTrabajoPreviewPanel preview={preview} />}

      {isEmpty && (
        <Alert variant="info" title="Sin trabajos">
          No hay trabajos asignados para este sector.
        </Alert>
      )}

      {!loading && !error && items.length > 0 && sections && (
        <div>
          <h2 className="mb-3 text-sm font-semibold">WorkItems del sector (detalle)</h2>
          <MiTrabajoSections
            hoy={sections.hoy}
            semana={sections.semana}
            pendientes={sections.pendientes}
            bloqueados={sections.bloqueados}
            showPreviewMeta
          />
        </div>
      )}

      {process.env.NODE_ENV === "development" && (
        <p className="text-center text-xs text-[var(--muted-foreground)]">
          <Link href="/debug/work-items" className="text-[var(--color-action)] hover:underline">
            /debug/work-items
          </Link>{" "}
          — diagnóstico técnico (solo desarrollo)
        </p>
      )}
    </div>
  );
}
