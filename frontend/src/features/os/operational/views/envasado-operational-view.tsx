"use client";

import { useCallback, useMemo } from "react";
import type { WorkItem } from "@/types/operational/work-item";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import { usePreviewContext, usePreviewSession } from "@/features/os/session/preview-context";
import { WorkItemProgressTable } from "../components/work-item-progress-table";
import { SyncStatusBar } from "../components/operational-ui";
import { OperationalDayNav } from "../components/operational-day-nav";
import { OperationalWeekBoard } from "../components/operational-week-board";
import { useOperationalPlan } from "../hooks/use-operational-plan";
import { useOperationalCalendar } from "../hooks/use-operational-calendar";
import { ELABORACION_RAMAS, SECTOR_PERSONNEL } from "../lib/sector-personnel";
import { useOperationalStore } from "../store/operational-store-context";

interface EnvasadoOperationalViewProps {
  sectorId: "ENVASADO_MASIVO" | "ENVASADO_PREMIUM";
}

/** Vista operativa envasado — avance por línea, filtrado por día (Hoy). */
export function EnvasadoOperationalView({ sectorId }: EnvasadoOperationalViewProps) {
  const workspace = useRequiredWorkspace();
  const { applyEffectiveStatus } = usePreviewContext();
  const calendar = useOperationalCalendar();
  const {
    applyProgressToWorkItems,
    saveWorkProgress,
    markWorkFinished,
    getFinishedQty,
    getObservation,
  } = useOperationalStore();

  const planOptions =
    calendar.viewMode === "week"
      ? { weekStart: calendar.weekStart }
      : { date: calendar.selectedDate };

  const { data, loading, error, lastRefreshAt, updatedAgoLabel, liveConnected } =
    useOperationalPlan(sectorId, planOptions);

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
        sector: sectorId,
      });
    },
    [saveWorkProgress, workspace.context.displayName, sectorId]
  );

  const handleFinish = useCallback(
    (item: WorkItem, payload: { finishedQty: string; observation: string }) => {
      markWorkFinished(item, {
        ...payload,
        updatedBy: workspace.context.displayName,
      });
    },
    [markWorkFinished, workspace.context.displayName]
  );

  return (
    <TwinShell title={workspace.sectorLabel}>
      <header className="mb-4 space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">
          Hola, {workspace.context.displayName}
        </h2>
        <p className="text-base font-medium text-[var(--os-text)]">{calendar.heading}</p>
        <p className="text-sm text-[var(--os-text-muted)]">
          {workspace.sectorLabel} · {workspace.context.jobTitle}
        </p>
        <SyncStatusBar
          source={data?.source ?? "demo"}
          lastRefreshAt={lastRefreshAt}
          updatedAgoLabel={updatedAgoLabel}
          liveConnected={liveConnected}
          loading={loading}
          detailMessage={data?.message}
        />
      </header>

      <OperationalDayNav
        selectedDate={calendar.selectedDate}
        today={calendar.today}
        viewMode={calendar.viewMode}
        onPrev={calendar.goPrevDay}
        onNext={calendar.goNextDay}
        onToday={calendar.goToday}
        onViewMode={calendar.setViewMode}
      />

      {error && (
        <div className="mb-4 rounded border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </div>
      )}

      {loading && !data && <div className="os-skeleton h-48 rounded-[var(--os-radius)]" />}

      {!loading && calendar.viewMode === "week" && (
        <OperationalWeekBoard
          weekDays={calendar.weekDays}
          today={calendar.today}
          selectedDate={calendar.selectedDate}
          items={sortedItems}
          onSelectDay={calendar.selectDay}
        />
      )}

      {!loading && calendar.viewMode === "day" && (
        <WorkItemProgressTable
          items={sortedItems}
          variant="envasado"
          getFinishedQty={getFinishedQty}
          getObservation={getObservation}
          onSaveProgress={handleSave}
          onMarkFinished={handleFinish}
          emptyMessage={
            data?.message ?? "No hay trabajos planificados para este día."
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
  const calendar = useOperationalCalendar();
  const {
    applyProgressToWorkItems,
    saveWorkProgress,
    markWorkFinished,
    getFinishedQty,
    getObservation,
  } = useOperationalStore();

  const planOptions =
    calendar.viewMode === "week"
      ? { ownerPerson, weekStart: calendar.weekStart }
      : { ownerPerson, date: calendar.selectedDate };

  const { data, loading, error, lastRefreshAt, updatedAgoLabel, liveConnected } =
    useOperationalPlan("ELABORACION", planOptions);

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
        sector: "ELABORACION",
      });
    },
    [saveWorkProgress, greetingName]
  );

  const handleFinish = useCallback(
    (item: WorkItem, payload: { finishedQty: string; observation: string }) => {
      markWorkFinished(item, {
        ...payload,
        updatedBy: greetingName,
      });
    },
    [markWorkFinished, greetingName]
  );

  const emptyMessage =
    data?.message ??
    (ramaLabel
      ? `No hay trabajos planificados para ${ramaLabel} en este día.`
      : "No hay trabajos planificados para este día.");

  return (
    <TwinShell title="Elaboración">
      <header className="mb-4 space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Hola, {greetingName}</h2>
        <p className="text-base font-medium text-[var(--os-text)]">{calendar.heading}</p>
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
          updatedAgoLabel={updatedAgoLabel}
          liveConnected={liveConnected}
          loading={loading}
          detailMessage={data?.message}
        />
      </header>

      <OperationalDayNav
        selectedDate={calendar.selectedDate}
        today={calendar.today}
        viewMode={calendar.viewMode}
        onPrev={calendar.goPrevDay}
        onNext={calendar.goNextDay}
        onToday={calendar.goToday}
        onViewMode={calendar.setViewMode}
      />

      {error && (
        <div className="mb-4 rounded border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </div>
      )}

      {loading && !data && <div className="os-skeleton h-40 rounded-[var(--os-radius)]" />}

      {!loading && calendar.viewMode === "week" && (
        <OperationalWeekBoard
          weekDays={calendar.weekDays}
          today={calendar.today}
          selectedDate={calendar.selectedDate}
          items={workItems}
          onSelectDay={calendar.selectDay}
        />
      )}

      {!loading && calendar.viewMode === "day" && isEncargado && ramas && (
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
                emptyMessage={`No hay trabajos para la rama ${rama} en este día.`}
              />
            </section>
          ))}
        </div>
      )}

      {!loading && calendar.viewMode === "day" && !isEncargado && (
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
