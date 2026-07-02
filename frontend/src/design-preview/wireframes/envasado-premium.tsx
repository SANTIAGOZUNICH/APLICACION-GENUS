"use client";

import { useEffect, useMemo, useState } from "react";
import { ContextPanel } from "@/design-preview/components/context-panel";
import { DateNavigator } from "@/design-preview/components/date-navigator";
import { EmptyState } from "@/design-preview/components/empty-state";
import { LineWorkCard } from "@/design-preview/components/line-work-card";
import { TwinShell } from "@/design-preview/components/twin-shell";
import { SummaryStrip } from "@/design-preview/components/summary-strip";
import { WeekPlanStrip } from "@/design-preview/components/week-plan-strip";
import { useSectorWorkItems } from "@/design-preview/hooks/use-sector-work-items";
import {
  addDays,
  formatLongDate,
  formatTime,
  getWorkWeekDays,
  isSameDay,
  startOfDay,
} from "@/design-preview/lib/calendar";
import { usePreviewContext } from "@/design-preview/lib/preview-context";
import { resolveSectorHome, sectorHasPanel } from "@/lib/role-engine";
import { buildCopilotContext } from "@/design-preview/lib/creamy-copilot";
import {
  buildLineScheduleView,
  buildWeekPlanSummary,
  discoverPackagingLines,
  extractProblems,
  extractUpcomingDeliveries,
  summarizeWorkItems,
} from "@/design-preview/lib/work-items-day-view";

const SECTOR_ID = "ENVASADO_PREMIUM" as const;

/** Envasado Premium — líneas reales desde bloques SEMANAS 2026. */
export function WireframeEnvasadoPremium() {
  const home = useMemo(() => resolveSectorHome(SECTOR_ID), []);
  const {
    openWorkItem,
    openOa,
    markWorkDone,
    applyEffectiveStatus,
    getEffectiveStatus,
    completingIds,
    setCreamyTeaser,
    openCreamy,
  } = usePreviewContext();
  const [today] = useState(() => startOfDay(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const { data, loading, error } = useSectorWorkItems(SECTOR_ID);

  const workItems = useMemo(
    () => applyEffectiveStatus(data?.workItems ?? []),
    [data?.workItems, applyEffectiveStatus]
  );
  const lineIds = useMemo(() => discoverPackagingLines(workItems), [workItems]);
  const scannedAt = data?.scannedAt ? new Date(data.scannedAt) : null;
  const weekDays = useMemo(() => getWorkWeekDays(today), [today]);
  const daySchedule = useMemo(
    () => buildLineScheduleView(workItems, selectedDate, today, lineIds),
    [workItems, selectedDate, today, lineIds]
  );
  const weekPlan = useMemo(
    () => buildWeekPlanSummary(workItems, weekDays, today),
    [workItems, weekDays, today]
  );
  const summary = useMemo(() => summarizeWorkItems(daySchedule.items), [daySchedule.items]);
  const copilot = useMemo(
    () =>
      buildCopilotContext(daySchedule.items, home.definition.title, home.creamyContext),
    [daySchedule.items, home.creamyContext, home.definition.title]
  );

  useEffect(() => {
    setCreamyTeaser({ headline: copilot.headline, hint: copilot.hint });
  }, [copilot.headline, copilot.hint, setCreamyTeaser]);

  const upcomingDeliveries = useMemo(
    () => extractUpcomingDeliveries(workItems, today),
    [workItems, today]
  );
  const problems = useMemo(() => extractProblems(daySchedule.items), [daySchedule.items]);

  const goPrevious = () => setSelectedDate((d) => addDays(d, -1));
  const goNext = () => setSelectedDate((d) => addDays(d, 1));
  const goToday = () => setSelectedDate(today);
  const viewingToday = isSameDay(selectedDate, today);

  const sourceLabel = data?.source === "drive" ? "SEMANAS 2026 · Premium · datos reales" : undefined;

  return (
    <TwinShell syncTime={scannedAt ?? undefined} contentClassName="!px-6 !py-6 lg:!px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 xl:max-w-none xl:flex-row xl:items-start xl:gap-10">
        <div className="min-w-0 flex-1 space-y-8">
          <header className="space-y-4">
            <h2 className="text-3xl font-semibold tracking-tight text-[var(--os-text)]">
              Hola, {home.definition.title}
            </h2>
            <p className="mt-2 text-base text-[var(--os-text-muted)]">
              {viewingToday ? "Hoy" : "Viendo"}:{" "}
              <span className="font-medium text-[var(--os-text)]">
                {formatLongDate(selectedDate)}
              </span>
            </p>
            <p className="text-xs text-[var(--os-text-muted)]">
              Sync: {scannedAt ? formatTime(scannedAt) : "—"} · {lineIds.length} línea(s)
            </p>
            <DateNavigator
              selectedDate={selectedDate}
              today={today}
              onPrevious={goPrevious}
              onNext={goNext}
              onToday={goToday}
              sourceLabel={sourceLabel}
            />
          </header>

          {loading && <div className="os-skeleton h-48 rounded-[var(--os-radius)]" />}

          {error && (
            <div className="rounded-[var(--os-radius)] border border-rose-200 bg-rose-50 px-6 py-8 text-sm text-rose-900">
              {error}
            </div>
          )}

          {!loading && data?.message && workItems.length === 0 && (
            <EmptyState title={home.emptyState.title} message={data.message} />
          )}

          {!loading && !error && workItems.length > 0 && daySchedule.jobCount === 0 && (
            <EmptyState
              title="Sin trabajos premium este día"
              message={`No hay trabajos premium para ${formatLongDate(selectedDate)}.`}
            />
          )}

          {!loading && !error && daySchedule.jobCount > 0 && (
            <>
              {sectorHasPanel(SECTOR_ID, "summary_strip") && (
                <SummaryStrip
                  paraHacer={summary.paraHacer}
                  enProgreso={summary.enProgreso}
                  terminadas={summary.terminadas}
                  bloqueadas={summary.bloqueadas}
                />
              )}

              <section className="space-y-4">
                <h3 className="text-lg font-semibold">Trabajo del día por línea</h3>
                <div className="flex flex-col gap-5">
                  {daySchedule.lines.map((slot) => (
                    <LineWorkCard
                      key={slot.lineId}
                      lineId={slot.lineId}
                      work={slot.work}
                      today={today}
                      status={slot.work ? getEffectiveStatus(slot.work) : undefined}
                      isCompleting={slot.work ? completingIds.has(slot.work.id) : false}
                      onOpenWork={openWorkItem}
                      onOpenOa={openOa}
                      onMarkDone={markWorkDone}
                    />
                  ))}
                </div>
              </section>

              {sectorHasPanel(SECTOR_ID, "week_plan") && (
                <WeekPlanStrip
                  weekDays={weekPlan}
                  selectedDate={selectedDate}
                  today={today}
                  onSelectDate={setSelectedDate}
                />
              )}
            </>
          )}
        </div>

        {!loading && !error && sectorHasPanel(SECTOR_ID, "context_panel") && (
          <div className="hidden w-full shrink-0 xl:block xl:w-80">
            <ContextPanel
              upcomingDeliveries={upcomingDeliveries}
              problems={problems}
              copilot={copilot}
              onSuggestionClick={() => openCreamy()}
            />
          </div>
        )}
      </div>
    </TwinShell>
  );
}
