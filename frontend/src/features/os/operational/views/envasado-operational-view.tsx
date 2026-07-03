"use client";

import { useCallback, useMemo } from "react";
import type { WorkItem } from "@/types/operational/work-item";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import { usePreviewContext, usePreviewSession } from "@/features/os/session/preview-context";
import { WorkItemProgressTable } from "../components/work-item-progress-table";
import { SyncStatusBar } from "../components/operational-ui";
import { useOperationalPlan } from "../hooks/use-operational-plan";
import { ELABORACION_RAMAS, SECTOR_PERSONNEL } from "../lib/sector-personnel";
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
    (item: WorkItem, payload: { finishedQty: string; observation: string }) => {
      markWorkFinished(item, {
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
        <h2 className="text-2xl font-semibold tracking-tight">
          Hola, {workspace.context.displayName}
        </h2>
        <p className="text-sm text-[var(--os-text-muted)]">
          {workspace.sectorLabel} · {workspace.context.jobTitle}
        </p>
        <SyncStatusBar
          source={data?.source ?? "demo"}
          lastRefreshAt={lastRefreshAt}
          loading={loading}
          onRefresh={refresh}
          detailMessage={data?.message}
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

/** Elaboración — encargado Santino + ramas Cristian / Nicolás. */
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

  const isEncargado = !ownerPerson?.trim();
  const ramaLabel = ownerPerson ?? null;
  const greetingName = ramaLabel ?? workspace.context.displayName;

  const workItems = useMemo(() => {
    const base = applyEffectiveStatus(data?.workItems ?? []);
    return applyProgressToWorkItems(base);
  }, [data?.workItems, applyEffectiveStatus, applyProgressToWorkItems]);

  const ramas = useMemo(() => {
    if (!isEncargado) return null;
    return ELABORACION_RAMAS.map((rama) => ({
      rama,
      items: workItems.filter((item) => item.ownerPerson === rama),
    }));
  }, [isEncargado, workItems]);

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
    (item: WorkItem, payload: { finishedQty: string; observation: string }) => {
      markWorkFinished(item, {
        ...payload,
        updatedBy: greetingName,
      });
      refresh();
    },
    [markWorkFinished, refresh, greetingName]
  );

  const emptyMessage =
    data?.message ??
    (ramaLabel
      ? `Sin elaboraciones asignadas a la rama ${ramaLabel} en SEMANAS 2026.`
      : "Sin elaboraciones en SEMANAS 2026.");

  return (
    <TwinShell title="Elaboración">
      <header className="mb-6 space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Hola, {greetingName}</h2>
        <div className="space-y-1 text-sm text-[var(--os-text-muted)]">
          <p>
            Encargado:{" "}
            <span className="font-medium text-[var(--os-text)]">
              {SECTOR_PERSONNEL.ELABORACION_ENCARGADO}
            </span>
          </p>
          {ramaLabel ? (
            <p>
              Rama{" "}
              <span className="font-medium text-[var(--os-teal)]">{ramaLabel}</span> · solo tu
              asignación
            </p>
          ) : (
            <p>
              Vista de encargado · ramas{" "}
              <span className="font-medium text-[var(--os-teal)]">
                {ELABORACION_RAMAS.join(" · ")}
              </span>
            </p>
          )}
        </div>
        <SyncStatusBar
          source={data?.source ?? "demo"}
          lastRefreshAt={lastRefreshAt}
          loading={loading}
          onRefresh={refresh}
          detailMessage={data?.message}
        />
      </header>

      {error && (
        <div className="mb-4 rounded border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </div>
      )}

      {loading && !data && <div className="os-skeleton h-40 rounded-[var(--os-radius)]" />}

      {!loading && isEncargado && ramas && (
        <div className="space-y-8">
          {ramas.map(({ rama, items }) => (
            <section key={rama}>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
                Rama {rama}
              </h3>
              <WorkItemProgressTable
                items={items}
                variant="elaboracion"
                getFinishedQty={getFinishedQty}
                getObservation={getObservation}
                onSaveProgress={handleSave}
                onMarkFinished={handleFinish}
                emptyMessage={`Sin elaboraciones para la rama ${rama}.`}
              />
            </section>
          ))}
        </div>
      )}

      {!loading && !isEncargado && (
        <WorkItemProgressTable
          items={workItems}
          variant="elaboracion"
          getFinishedQty={getFinishedQty}
          getObservation={getObservation}
          onSaveProgress={handleSave}
          onMarkFinished={handleFinish}
          emptyMessage={emptyMessage}
        />
      )}
    </TwinShell>
  );
}
