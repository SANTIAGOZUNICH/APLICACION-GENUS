"use client";

import { useCallback, useMemo } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import { usePreviewContext, usePreviewSession } from "@/features/os/session/preview-context";
import { WorkItemProgressTable } from "../components/work-item-progress-table";
import { SyncStatusBar } from "../components/operational-ui";
import { useOperationalPlan } from "../hooks/use-operational-plan";
import { useOperationalStore } from "../store/operational-store-context";

interface EnvasadoOperationalViewProps {
  sectorId: "ENVASADO_MASIVO" | "ENVASADO_PREMIUM";
}

/** Vista operativa envasado — avance por línea con guardar y marcar terminado. */
export function EnvasadoOperationalView({ sectorId }: EnvasadoOperationalViewProps) {
  const workspace = useRequiredWorkspace();
  const { applyEffectiveStatus } = usePreviewContext();
  const {
    applyProgressToWorkItems,
    saveWorkProgress,
    markWorkFinished,
    getFinishedQty,
    getObservation,
  } = useOperationalStore();
  const { data, loading, error, lastRefreshAt, refresh } = useOperationalPlan(sectorId);

  const workItems = useMemo(() => {
    const base = applyEffectiveStatus(data?.workItems ?? []);
    return applyProgressToWorkItems(base);
  }, [data?.workItems, applyEffectiveStatus, applyProgressToWorkItems]);

  const sortedItems = useMemo(
    () =>
      [...workItems].sort((a, b) =>
        (a.line ?? "").localeCompare(b.line ?? "", "es", { sensitivity: "base" })
      ),
    [workItems]
  );

  const handleSave = useCallback(
    (itemId: string, payload: { finishedQty: string; observation: string }) => {
      saveWorkProgress(itemId, {
        ...payload,
        updatedBy: workspace.context.displayName,
      });
      refresh();
    },
    [saveWorkProgress, refresh, workspace.context.displayName]
  );

  const handleFinish = useCallback(
    (itemId: string, payload: { finishedQty: string; observation: string }) => {
      markWorkFinished(itemId, {
        ...payload,
        updatedBy: workspace.context.displayName,
      });
      refresh();
    },
    [markWorkFinished, refresh, workspace.context.displayName]
  );

  return (
    <TwinShell title={workspace.sectorLabel}>
      <header className="mb-6 space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">{workspace.sectorLabel}</h2>
        <p className="text-sm text-[var(--os-text-muted)]">{workspace.subtitle}</p>
        <SyncStatusBar
          source={data?.source ?? "demo"}
          lastRefreshAt={lastRefreshAt}
          loading={loading}
          onRefresh={refresh}
        />
      </header>

      {error && (
        <div className="mb-4 rounded border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </div>
      )}

      {loading && !data && <div className="os-skeleton h-48 rounded-[var(--os-radius)]" />}

      {!loading && (
        <WorkItemProgressTable
          items={sortedItems}
          variant="envasado"
          getFinishedQty={getFinishedQty}
          getObservation={getObservation}
          onSaveProgress={handleSave}
          onMarkFinished={handleFinish}
          emptyMessage={
            data?.message ?? "Sin líneas de acondicionamiento para este sector."
          }
        />
      )}
    </TwinShell>
  );
}

/** Elaboración filtrada por persona — Cristian / Nicolás. */
export function ElaboracionOperationalView() {
  const workspace = useRequiredWorkspace();
  const { ownerPerson } = usePreviewSession();
  const { applyEffectiveStatus } = usePreviewContext();
  const {
    applyProgressToWorkItems,
    saveWorkProgress,
    markWorkFinished,
    getFinishedQty,
    getObservation,
  } = useOperationalStore();
  const { data, loading, error, lastRefreshAt, refresh } = useOperationalPlan("ELABORACION", {
    ownerPerson,
  });

  const greetingName = ownerPerson ?? workspace.context.firstName;

  const workItems = useMemo(() => {
    const base = applyEffectiveStatus(data?.workItems ?? []);
    return applyProgressToWorkItems(base);
  }, [data?.workItems, applyEffectiveStatus, applyProgressToWorkItems]);

  const handleSave = useCallback(
    (itemId: string, payload: { finishedQty: string; observation: string }) => {
      saveWorkProgress(itemId, {
        ...payload,
        updatedBy: greetingName,
      });
      refresh();
    },
    [saveWorkProgress, refresh, greetingName]
  );

  const handleFinish = useCallback(
    (itemId: string, payload: { finishedQty: string; observation: string }) => {
      markWorkFinished(itemId, {
        ...payload,
        updatedBy: greetingName,
      });
      refresh();
    },
    [markWorkFinished, refresh, greetingName]
  );

  return (
    <TwinShell title="Elaboración">
      <header className="mb-6 space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Hola, {greetingName}</h2>
        <p className="text-sm text-[var(--os-text-muted)]">
          Elaboraciones asignadas · bloque {greetingName} en SEMANAS
        </p>
        <SyncStatusBar
          source={data?.source ?? "demo"}
          lastRefreshAt={lastRefreshAt}
          loading={loading}
          onRefresh={refresh}
        />
      </header>

      {error && (
        <div className="mb-4 rounded border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </div>
      )}

      {loading && !data && <div className="os-skeleton h-40 rounded-[var(--os-radius)]" />}

      {!loading && (
        <WorkItemProgressTable
          items={workItems}
          variant="elaboracion"
          getFinishedQty={getFinishedQty}
          getObservation={getObservation}
          onSaveProgress={handleSave}
          onMarkFinished={handleFinish}
          emptyMessage={`Sin elaboraciones para ${greetingName}.`}
        />
      )}
    </TwinShell>
  );
}
