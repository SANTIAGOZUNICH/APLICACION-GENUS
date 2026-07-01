"use client";

import { useEffect, useState } from "react";
import { EntityPageClient } from "@/components/patterns/actions/entity-page-client";
import { EntityPageNotFound } from "@/components/patterns/entity-page/entity-page-not-found";
import { RealDataSourceBanner } from "@/components/data/real-data-source-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { useOperationsStore } from "@/lib/operations/operations-store";
import { entityPageKey } from "@/types/actions";
import type { EntityPageKind } from "@/types/entity-page";
import { FileQuestion } from "lucide-react";

const ENTITY_LABELS: Record<EntityPageKind, string> = {
  oe: "OE",
  oa: "OA",
  lote: "LOTE",
  pedido: "PEDIDO",
  liberacion: "LIBERACIÓN",
};

interface EntityPageLoaderProps {
  kind: EntityPageKind;
  entityId: string;
}

/** E7.2 loader — hydrates entity pages from the BFF without modifying E6 patterns. */
export function EntityPageLoader({ kind, entityId }: EntityPageLoaderProps) {
  const {
    state,
    loading,
    error,
    ensureEntityLoaded,
    dataMode,
    dataSource,
    diagnostics,
    getEntitySource,
    hydrated,
  } = useOperationsStore();
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      const found = await ensureEntityLoaded(kind, entityId);
      if (active) {
        setResolved(found);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [kind, entityId, ensureEntityLoaded]);

  const key = entityPageKey(kind, entityId);
  const exists = Boolean(state.entityPages[key]);
  const entitySource = getEntitySource(kind, entityId);

  if ((loading && !hydrated) || (!exists && !resolved && dataMode === "real")) {
    return (
      <div className="space-y-4">
        <RealDataSourceBanner
          dataMode={dataMode}
          dataSource={dataSource}
          diagnostics={diagnostics}
          loading
        />
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-8 text-center">
          <p className="text-sm font-medium text-[var(--foreground)]">
            Cargando {ENTITY_LABELS[kind].toLowerCase()}…
          </p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Consultando Google Drive vía BFF
          </p>
        </div>
      </div>
    );
  }

  if (dataMode === "demo" && !exists) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="Entidad demo no encontrada"
        description={`No hay mock demo para ${ENTITY_LABELS[kind]} ${entityId}.`}
      />
    );
  }

  if (error && !exists) {
    return (
      <div className="space-y-4">
        <RealDataSourceBanner
          dataMode={dataMode}
          dataSource={dataSource}
          diagnostics={diagnostics}
        />
        <div
          className="rounded-lg border border-[var(--badge-problem-border)] bg-[var(--badge-problem-bg)] px-4 py-3 text-sm text-[var(--foreground)]"
          role="alert"
        >
          <p className="font-medium">
            No pudimos cargar {ENTITY_LABELS[kind].toLowerCase()}
          </p>
          <p className="mt-1 text-[var(--muted-foreground)]">{error}</p>
        </div>
        <EntityPageNotFound entityLabel={ENTITY_LABELS[kind]} entityId={entityId} />
      </div>
    );
  }

  if (!exists && resolved) {
    return (
      <div className="space-y-4">
        <RealDataSourceBanner
          dataMode={dataMode}
          dataSource={dataSource}
          diagnostics={diagnostics}
        />
        <EmptyState
          icon={FileQuestion}
          title="Sin datos reales disponibles todavía"
          description={`No encontramos ${ENTITY_LABELS[kind]} ${entityId} en Drive/Sheets.`}
          tone="positive"
        />
      </div>
    );
  }

  if (!exists) {
    return null;
  }

  const isDemoFallback =
    dataMode === "real" && entitySource === "demo";

  return (
    <div className="space-y-4">
      {dataMode === "real" && (
        <RealDataSourceBanner
          dataMode={dataMode}
          dataSource={isDemoFallback ? "demo" : dataSource}
          diagnostics={
            isDemoFallback
              ? {
                  dataMode: "real",
                  source: "demo",
                  counts: diagnostics?.counts ?? {
                    oe: 0,
                    lotes: 0,
                    pedidos: 0,
                    oa: 0,
                    liberaciones: 0,
                  },
                  fallbackUsed: {
                    bandeja: false,
                    workspaces: false,
                    entityPages: true,
                    panorama: false,
                  },
                  message:
                    "Esta ficha usa fallback demo — no proviene de Drive/Sheets.",
                }
              : diagnostics
          }
        />
      )}
      <EntityPageClient kind={kind} entityId={entityId} />
    </div>
  );
}
