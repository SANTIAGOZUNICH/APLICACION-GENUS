"use client";

import { useMemo, useState } from "react";
import { ContextPanel } from "@/design-preview/components/context-panel";
import { DateNavigator } from "@/design-preview/components/date-navigator";
import { LineWorkCard } from "@/design-preview/components/line-work-card";
import { OsShell } from "@/design-preview/components/os-shell";
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
import { resolveSectorHome, sectorHasPanel } from "@/lib/role-engine";
import { buildCopilotContext } from "@/design-preview/lib/creamy-copilot";
import {
  buildDayScheduleView,
  buildWeekPlanSummary,
  extractProblems,
  extractUpcomingDeliveries,
  summarizeWorkItems,
} from "@/design-preview/lib/work-items-day-view";

const SECTOR_ID = "ENVASADO_MASIVO" as const;

/** Envasado Masivo — Home resuelta por Role Engine + WorkItems reales. */
export function WireframeEnvasadoMasivo() {
  const home = useMemo(() => resolveSectorHome(SECTOR_ID), []);
  const [today] = useState(() => startOfDay(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const { data, loading, error } = useSectorWorkItems(SECTOR_ID);

  const workItems = useMemo(() => data?.workItems ?? [], [data?.workItems]);
  const scannedAt = data?.scannedAt ? new Date(data.scannedAt) : null;

  const weekDays = useMemo(() => getWorkWeekDays(today), [today]);
  const daySchedule = useMemo(
    () => buildDayScheduleView(workItems, selectedDate, today),
    [workItems, selectedDate, today]
  );
  const weekPlan = useMemo(
    () => buildWeekPlanSummary(workItems, weekDays, today),
    [workItems, weekDays, today]
  );
  const summary = useMemo(() => summarizeWorkItems(daySchedule.items), [daySchedule.items]);
  const copilot = useMemo(
    () =>
      buildCopilotContext(
        daySchedule.items,
        home.definition.title,
        home.creamyContext
      ),
    [daySchedule.items, home.creamyContext, home.definition.title]
  );

  const upcomingDeliveries = useMemo(
    () => extractUpcomingDeliveries(workItems, today),
    [workItems, today]
  );
  const problems = useMemo(
    () => extractProblems(daySchedule.items),
    [daySchedule.items]
  );

  const goPrevious = () => setSelectedDate((d) => addDays(d, -1));
  const goNext = () => setSelectedDate((d) => addDays(d, 1));
  const goToday = () => setSelectedDate(today);
  const viewingToday = isSameDay(selectedDate, today);

  const sourceLabel = data
    ? data.source === "drive"
      ? "SEMANAS 2026 · datos reales"
      : "Sin datos reales — configurar GENUS_DATA_MODE=real y Drive"
    : undefined;

  return (
    <OsShell
      sectorLabel={home.definition.title}
      sectorEmail="emasivo@laboratoriogenus.com.ar"
      syncTime={scannedAt ?? undefined}
      contentClassName="!px-6 !py-6 lg:!px-8"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-8 xl:max-w-none xl:flex-row xl:items-start xl:gap-10">
        <div className="min-w-0 flex-1 space-y-8">
          {sectorHasPanel(SECTOR_ID, "header_greeting") && (
            <header className="space-y-4">
              <div>
                <h2 className="text-3xl font-semibold tracking-tight text-[var(--os-text)]">
                  Hola, {home.definition.title}
                </h2>
                <p className="mt-2 text-base text-[var(--os-text-muted)]">
                  {viewingToday ? "Hoy" : "Viendo"}:{" "}
                  <span className="font-medium text-[var(--os-text)]">
                    {formatLongDate(selectedDate)}
                  </span>
                </p>
                <p className="mt-1 text-xs text-[var(--os-text-muted)]">
                  Última sincronización: {scannedAt ? formatTime(scannedAt) : "—"}
                </p>
              </div>

              {sectorHasPanel(SECTOR_ID, "date_navigator") && (
                <DateNavigator
                  selectedDate={selectedDate}
                  today={today}
                  onPrevious={goPrevious}
                  onNext={goNext}
                  onToday={goToday}
                  sourceLabel={sourceLabel}
                />
              )}
            </header>
          )}

          {loading && (
            <div className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] px-6 py-8 text-sm text-[var(--os-text-muted)]">
              Cargando WorkItems desde SEMANAS 2026…
            </div>
          )}

          {error && (
            <div className="rounded-[var(--os-radius)] border border-rose-200 bg-rose-50 px-6 py-8 text-sm text-rose-900">
              {error}
            </div>
          )}

          {!loading && data?.message && workItems.length === 0 && (
            <div className="rounded-[var(--os-radius)] border border-amber-200 bg-amber-50 px-6 py-8 text-sm text-amber-950">
              {data.message}
              {data.warnings?.[0] && (
                <p className="mt-2 text-xs opacity-80">{data.warnings[0]}</p>
              )}
            </div>
          )}

          {!loading && !error && (
            <>
              {sectorHasPanel(SECTOR_ID, "summary_strip") && (
                <SummaryStrip
                  paraHacer={summary.paraHacer}
                  enProgreso={summary.enProgreso}
                  terminadas={summary.terminadas}
                  bloqueadas={summary.bloqueadas}
                />
              )}

              {sectorHasPanel(SECTOR_ID, "line_work_cards") && (
                <section className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold text-[var(--os-text)]">Trabajo del día</h3>
                    <p className="mt-1 text-sm text-[var(--os-text-muted)]">
                      {daySchedule.jobCount > 0
                        ? `${daySchedule.jobCount} trabajo(s) · ${daySchedule.totalUnits.toLocaleString("es-AR")} u`
                        : home.emptyState.message}
                    </p>
                  </div>
                  <div className="flex flex-col gap-5">
                    {daySchedule.lines.map((slot) => (
                      <LineWorkCard
                        key={slot.lineId}
                        lineId={slot.lineId}
                        work={slot.work}
                        today={today}
                      />
                    ))}
                  </div>
                </section>
              )}

              {sectorHasPanel(SECTOR_ID, "week_plan") && (
                <section className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold text-[var(--os-text)]">Plan semanal</h3>
                    <p className="mt-1 text-sm text-[var(--os-text-muted)]">
                      Lunes a viernes · click en un día para cambiar la vista
                    </p>
                  </div>
                  <WeekPlanStrip
                    weekDays={weekPlan}
                    selectedDate={selectedDate}
                    today={today}
                    onSelectDate={setSelectedDate}
                  />
                </section>
              )}
            </>
          )}
        </div>

        {!loading && !error && sectorHasPanel(SECTOR_ID, "context_panel") && (
          <div className="w-full shrink-0 xl:w-80">
            <ContextPanel
              upcomingDeliveries={upcomingDeliveries}
              problems={problems}
              copilot={copilot}
            />
          </div>
        )}
      </div>
    </OsShell>
  );
}
