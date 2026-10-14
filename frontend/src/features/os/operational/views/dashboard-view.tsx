"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { clearDashboardTargetApi, fetchDashboardApi, saveDashboardTargetApi } from "@/lib/dashboard/dashboard-client";
import type { DashboardFilters, DashboardPayload } from "@/lib/dashboard/types";
import { DashboardContent } from "../components/dashboard/dashboard-content";

function initialFilters(): DashboardFilters {
  // El servidor corrige el año por defecto; acá solo se arranca con el año calendario local.
  return { year: new Date().getFullYear(), month: null, sector: "ALL", client: null };
}

/**
 * Dashboard Operativo — visible para TODOS los sectores. Los datos y permisos los decide el servidor
 * (`/api/v1/dashboard`): esta vista solo muestra lo que llega.
 */
export function DashboardView() {
  const { email, sectorId } = usePreviewSession();
  const session = useMemo(() => ({ email: email ?? "", sector: sectorId }), [email, sectorId]);
  const [filters, setFilters] = useState<DashboardFilters>(initialFilters);
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- arranca la carga al cambiar filtros
    setLoading(true);
    fetchDashboardApi(session, filters, ctrl.signal)
      .then((p) => {
        setPayload(p);
        setError(null);
        // El servidor puede haber normalizado el año (p. ej. año por defecto): se respeta lo que él devolvió.
        setFilters((prev) => (prev.year === p.header.year ? prev : { ...prev, year: p.header.year }));
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : "No se pudo cargar el Dashboard");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [session, filters, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const saveTarget = useCallback(
    async (input: { key: string; value: number; direction: "min" | "max" }) => {
      await saveDashboardTargetApi(session, input);
      refresh();
    },
    [session, refresh]
  );
  const clearTarget = useCallback(
    async (key: string) => {
      await clearDashboardTargetApi(session, key);
      refresh();
    },
    [session, refresh]
  );

  return (
    <TwinShell title="Dashboard Operativo">
      {error ? (
        <div className="mb-4 rounded-[var(--os-radius)] border border-red-400/40 bg-red-400/10 px-4 py-3 text-sm text-red-200" role="alert" data-testid="dashboard-error">
          {error}{" "}
          <button type="button" className="underline" onClick={refresh}>
            Reintentar
          </button>
        </div>
      ) : null}
      {payload ? (
        <DashboardContent
          payload={payload}
          filters={filters}
          loading={loading}
          onFiltersChange={setFilters}
          onRefresh={refresh}
          onSaveTarget={saveTarget}
          onClearTarget={clearTarget}
        />
      ) : !error ? (
        <p className="py-10 text-center text-sm text-[var(--os-text-muted)]" data-testid="dashboard-loading">
          Cargando Dashboard…
        </p>
      ) : null}
    </TwinShell>
  );
}
