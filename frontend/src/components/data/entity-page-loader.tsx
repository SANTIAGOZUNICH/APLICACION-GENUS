"use client";

import { useEffect, useState } from "react";
import { EntityPageClient } from "@/components/patterns/actions/entity-page-client";
import { EntityPageNotFound } from "@/components/patterns/entity-page/entity-page-not-found";
import { useOperationsStore } from "@/lib/operations/operations-store";
import { entityPageKey } from "@/types/actions";
import type { EntityPageKind } from "@/types/entity-page";
import { getClientDataMode } from "@/lib/config/data-mode";

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
  const { state, loading, error, ensureEntityLoaded, dataSource } =
    useOperationsStore();
  const [resolved, setResolved] = useState(false);
  const dataMode = getClientDataMode();

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

  const exists = Boolean(state.entityPages[entityPageKey(kind, entityId)]);

  if (loading && !exists) {
    return (
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-8 text-center">
        <p className="text-sm font-medium text-[var(--foreground)]">
          Cargando {ENTITY_LABELS[kind].toLowerCase()}…
        </p>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          {dataMode === "real"
            ? "Consultando Google Drive vía BFF"
            : "Preparando datos demo"}
        </p>
      </div>
    );
  }

  if (error && !exists) {
    return (
      <div className="space-y-4">
        <div
          className="rounded-lg border border-[var(--badge-problem-border)] bg-[var(--badge-problem-bg)] px-4 py-3 text-sm text-[var(--foreground)]"
          role="alert"
        >
          <p className="font-medium">
            No pudimos cargar {ENTITY_LABELS[kind].toLowerCase()}
          </p>
          <p className="mt-1 text-[var(--muted-foreground)]">{error}</p>
        </div>
        <EntityPageNotFound
          entityLabel={ENTITY_LABELS[kind]}
          entityId={entityId}
        />
      </div>
    );
  }

  if (!exists && resolved) {
    return (
      <EntityPageNotFound
        entityLabel={ENTITY_LABELS[kind]}
        entityId={entityId}
      />
    );
  }

  if (!exists) {
    return null;
  }

  return (
    <>
      {dataMode === "real" && dataSource !== "initial" && (
        <div
          className="mb-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted-foreground)]"
          aria-live="polite"
        >
          {dataSource === "drive" || dataSource === "sheets"
            ? `Datos de ${ENTITY_LABELS[kind].toLowerCase()} desde Google Drive.`
            : "Modo real con fallback demo activo — no se pudo leer Drive."}
        </div>
      )}
      <EntityPageClient kind={kind} entityId={entityId} />
    </>
  );
}
