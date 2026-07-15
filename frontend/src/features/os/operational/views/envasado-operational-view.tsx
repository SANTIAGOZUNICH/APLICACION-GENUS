"use client";

import { useCallback, useMemo, useState } from "react";
import type { WorkItem } from "@/types/operational/work-item";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import { usePreviewContext } from "@/features/os/session/preview-context";
import { personNamesMatch } from "@/lib/operational/display-fields";
import { WorkItemProgressTable } from "../components/work-item-progress-table";
import { WorkItemDrawer } from "../components/work-item-drawer";
import { SyncStatusBar, OperationalTabs } from "../components/operational-ui";
import { OperationalDayNav } from "../components/operational-day-nav";
import { OperationalWeekBoard } from "../components/operational-week-board";
import { useOperationalPlan } from "../hooks/use-operational-plan";
import { useOperationalCalendar } from "../hooks/use-operational-calendar";
import { nativeDayEmptyMessage, nativeEmptyPlanMessage } from "../lib/native-empty-copy";
import { ELABORACION_RAMAS, SECTOR_PERSONNEL } from "../lib/sector-personnel";
import { LINE_TAB_LABELS, resolveLineBucket, type LineBucket } from "../lib/line-buckets";
import { listManualWorkItems } from "../adapters/manual-work-items-repository";
import { pushNotification } from "@/features/os/feedback/notifications-store";
import { useOperationalStore } from "../store/operational-store-context";

interface EnvasadoOperationalViewProps {
  sectorId: "ENVASADO_MASIVO" | "ENVASADO_PREMIUM";
}

function useOptionalLineToggle(sectorId: "ENVASADO_MASIVO" | "ENVASADO_PREMIUM") {
  const storageKey = `genus_os_${sectorId.toLowerCase()}_linea_opcional_enabled`;
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    const raw = window.localStorage.getItem(storageKey);
    return raw === null ? true : raw === "true";
  });

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") window.localStorage.setItem(storageKey, String(next));
      return next;
    });
  }, [storageKey]);

  return { enabled, toggle };
}

/** Vista operativa envasado — pestañas por línea, filtrado por día (Hoy). */
export function EnvasadoOperationalView({ sectorId }: EnvasadoOperationalViewProps) {
  const workspace = useRequiredWorkspace();
  const { applyEffectiveStatus, showToast } = usePreviewContext();
  const calendar = useOperationalCalendar();
  const {
    applyProgressToWorkItems,
    saveWorkProgress,
    markWorkFinished,
    getFinishedQty,
    getObservation,
  } = useOperationalStore();
  const { enabled: optionalLineEnabled, toggle: toggleOptionalLine } =
    useOptionalLineToggle(sectorId);

  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const availableLines: LineBucket[] = useMemo(() => {
    const base: LineBucket[] = sectorId === "ENVASADO_MASIVO" ? ["1", "2", "3"] : ["1"];
    return optionalLineEnabled ? [...base, sectorId === "ENVASADO_MASIVO" ? "opcional" : "2"] : base;
  }, [sectorId, optionalLineEnabled]);

  const [activeLine, setActiveLine] = useState<LineBucket>("1");

  const planOptions =
    calendar.viewMode === "week"
      ? { weekStart: calendar.weekStart }
      : { date: calendar.selectedDate };

  const { data, loading, error, lastRefreshAt, updatedAgoLabel, liveConnected } =
    useOperationalPlan(sectorId, planOptions);

  const workItems = useMemo(() => {
    const manual = listManualWorkItems(sectorId);
    const base = applyEffectiveStatus([...(data?.workItems ?? []), ...manual]);
    return applyProgressToWorkItems(base);
  }, [data?.workItems, sectorId, applyEffectiveStatus, applyProgressToWorkItems]);

  const itemsForActiveLine = useMemo(
    () => workItems.filter((item) => (resolveLineBucket(item.line) ?? "1") === activeLine),
    [workItems, activeLine]
  );

  const sortedItems = useMemo(
    () =>
      [...itemsForActiveLine].sort((a, b) =>
        (a.line ?? "").localeCompare(b.line ?? "", "es", { sensitivity: "base" })
      ),
    [itemsForActiveLine]
  );

  const handleSave = useCallback(
    (itemId: string, payload: { finishedQty: string; observation: string }) => {
      saveWorkProgress(itemId, {
        ...payload,
        updatedBy: workspace.context.displayName,
        sector: sectorId,
      });
      showToast("Avance guardado.");
    },
    [saveWorkProgress, workspace.context.displayName, sectorId, showToast]
  );

  const handleFinish = useCallback(
    (item: WorkItem, payload: { finishedQty: string; observation: string }) => {
      markWorkFinished(item, {
        ...payload,
        updatedBy: workspace.context.displayName,
      });
      pushNotification({
        kind: "trabajo_finalizado",
        title: `Trabajo finalizado — ${workspace.sectorLabel}`,
        message: `${item.product ?? "Producto"} · ${item.client ?? ""} listo para revisión de Calidad.`,
        sectors: ["CALIDAD"],
      });
      showToast("Trabajo enviado a Calidad.");
    },
    [markWorkFinished, workspace.context.displayName, workspace.sectorLabel, showToast]
  );

  const tabs = availableLines.map((bucket) => ({ id: bucket, label: LINE_TAB_LABELS[bucket] }));

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
          detailMessage={data?.source === "native" ? null : data?.message}
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
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <OperationalTabs tabs={tabs} activeId={activeLine} onChange={(id) => setActiveLine(id as LineBucket)} />
            <label className="flex items-center gap-2 text-xs text-[var(--os-text-muted)]">
              <input
                type="checkbox"
                checked={optionalLineEnabled}
                onChange={toggleOptionalLine}
                className="size-4 accent-[var(--os-teal)]"
              />
              Línea opcional activa
            </label>
          </div>

          <WorkItemProgressTable
            items={sortedItems}
            variant="envasado"
            getFinishedQty={getFinishedQty}
            getObservation={getObservation}
            onSelectItem={(item) => {
              setSelectedItem(item);
              setDrawerOpen(true);
            }}
            emptyMessage={
              data?.source === "native"
                ? nativeEmptyPlanMessage({
                    date: calendar.selectedDate,
                    sector: sectorId,
                  })
                : (data?.message ?? "No hay trabajos planificados para este día.")
            }
          />
        </div>
      )}

      <WorkItemDrawer
        item={selectedItem}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        variant="envasado"
        responsibleLabel="Línea"
        getFinishedQty={getFinishedQty}
        getObservation={getObservation}
        onSaveProgress={handleSave}
        onMarkFinished={handleFinish}
      />
    </TwinShell>
  );
}

/** Elaboración — sector único con ramas Cristian / Nicolás separadas. */
export function ElaboracionOperationalView() {
  const { applyEffectiveStatus, showToast } = usePreviewContext();
  const calendar = useOperationalCalendar();
  const {
    applyProgressToWorkItems,
    saveWorkProgress,
    markWorkFinished,
    getFinishedQty,
    getObservation,
  } = useOperationalStore();

  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const planOptions =
    calendar.viewMode === "week"
      ? { weekStart: calendar.weekStart }
      : { date: calendar.selectedDate };

  const { data, loading, error, lastRefreshAt, updatedAgoLabel, liveConnected } =
    useOperationalPlan("ELABORACION", planOptions);

  const workItems = useMemo(() => {
    const manual = listManualWorkItems("ELABORACION");
    const base = applyEffectiveStatus([...(data?.workItems ?? []), ...manual]);
    return applyProgressToWorkItems(base);
  }, [data?.workItems, applyEffectiveStatus, applyProgressToWorkItems]);

  const ramas = useMemo(
    () =>
      ELABORACION_RAMAS.map((rama) => ({
        rama,
        items: workItems.filter((item) =>
          personNamesMatch(item.ownerPerson, rama)
        ),
      })),
    [workItems]
  );

  const handleSave = useCallback(
    (itemId: string, payload: { finishedQty: string; observation: string }) => {
      const item = workItems.find((w) => w.id === itemId);
      const rama = item?.ownerPerson?.trim() || "Elaboración";
      saveWorkProgress(itemId, {
        ...payload,
        updatedBy: rama,
        sector: "ELABORACION",
      });
      showToast("Avance guardado.");
    },
    [saveWorkProgress, workItems, showToast]
  );

  const handleFinish = useCallback(
    (item: WorkItem, payload: { finishedQty: string; observation: string }) => {
      const rama = item.ownerPerson?.trim() || "Elaboración";
      markWorkFinished(item, {
        ...payload,
        updatedBy: rama,
      });
      pushNotification({
        kind: "trabajo_finalizado",
        title: "Trabajo finalizado — Elaboración",
        message: `${item.product ?? "Producto"} · ${item.client ?? ""} listo para revisión de Calidad.`,
        sectors: ["CALIDAD"],
      });
      showToast("Trabajo enviado a Calidad.");
    },
    [markWorkFinished, showToast]
  );

  return (
    <TwinShell title="Elaboración">
      <header className="mb-4 space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Elaboración</h2>
        <p className="text-sm text-[var(--os-text-muted)]">
          Encargado:{" "}
          <span className="font-medium text-[var(--os-text)]">
            {SECTOR_PERSONNEL.ELABORACION_ENCARGADO}
          </span>
        </p>
        <p className="text-base font-medium text-[var(--os-text)]">{calendar.heading}</p>
        <SyncStatusBar
          source={data?.source ?? "demo"}
          lastRefreshAt={lastRefreshAt}
          updatedAgoLabel={updatedAgoLabel}
          liveConnected={liveConnected}
          loading={loading}
          detailMessage={data?.source === "native" ? null : data?.message}
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

      {!loading && calendar.viewMode === "day" && (
        <div className="space-y-10">
          {ramas.map(({ rama, items }) => (
            <section key={rama}>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
                {rama}
              </h3>
              <WorkItemProgressTable
                items={items}
                variant="elaboracion"
                getFinishedQty={getFinishedQty}
                getObservation={getObservation}
                onSelectItem={(item) => {
                  setSelectedItem(item);
                  setDrawerOpen(true);
                }}
                emptyMessage={
                  data?.source === "native"
                    ? nativeDayEmptyMessage(rama)
                    : `No hay trabajos para ${rama} en este día.`
                }
              />
            </section>
          ))}
        </div>
      )}

      <WorkItemDrawer
        item={selectedItem}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        variant="elaboracion"
        responsibleLabel="Responsable"
        getFinishedQty={getFinishedQty}
        getObservation={getObservation}
        onSaveProgress={handleSave}
        onMarkFinished={handleFinish}
      />
    </TwinShell>
  );
}
