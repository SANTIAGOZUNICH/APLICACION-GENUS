"use client";

import { useMemo, useState } from "react";
import { ContextPanel } from "@/design-preview/components/context-panel";
import { DateNavigator } from "@/design-preview/components/date-navigator";
import { LineWorkCard } from "@/design-preview/components/line-work-card";
import { OsShell } from "@/design-preview/components/os-shell";
import { SummaryStrip } from "@/design-preview/components/summary-strip";
import { WeekPlanStrip } from "@/design-preview/components/week-plan-strip";
import {
  addDays,
  formatLongDate,
  formatTime,
  getWorkWeekDays,
  isSameDay,
  startOfDay,
} from "@/design-preview/lib/calendar-mock";
import {
  buildMasivoWeekSchedule,
  getMasivoScheduleForDate,
  summarizeDay,
} from "@/design-preview/mock-data/envasado-masivo-schedule";

/** Envasado Masivo — puesto de trabajo digital con fecha dinámica (mock SEMANAS 2026). */
export function WireframeEnvasadoMasivo() {
  const [today] = useState(() => startOfDay(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [syncTime] = useState(() => new Date());

  const weekDays = useMemo(() => getWorkWeekDays(today), [today]);
  const schedule = useMemo(() => buildMasivoWeekSchedule(today), [today]);
  const daySchedule = useMemo(
    () => getMasivoScheduleForDate(schedule, selectedDate),
    [schedule, selectedDate]
  );
  const summary = useMemo(() => summarizeDay(daySchedule), [daySchedule]);

  const creamyHint = useMemo(() => {
    const works = daySchedule.lines.map((l) => l.work).filter(Boolean);
    if (works.length === 0) return "No hay trabajos asignados. ¿Consulto el plan de la semana?";
    const urgent = works.find((w) => w?.priority === "HOY" || w?.priority === "URGENTE");
    if (urgent) {
      return `Prioridad ${urgent.client} — ${urgent.product}. ¿Te ayudo con la OA?`;
    }
    return "¿Necesitás ayuda con el trabajo de este día?";
  }, [daySchedule]);

  const goPrevious = () => setSelectedDate((d) => addDays(d, -1));
  const goNext = () => setSelectedDate((d) => addDays(d, 1));
  const goToday = () => setSelectedDate(today);

  const viewingToday = isSameDay(selectedDate, today);

  return (
    <OsShell
      sectorLabel="Envasado Masivo"
      sectorEmail="emasivo@laboratoriogenus.com.ar"
      syncTime={syncTime}
      contentClassName="!px-6 !py-6 lg:!px-8"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-8 xl:max-w-none xl:flex-row xl:items-start xl:gap-10">
        <div className="min-w-0 flex-1 space-y-8">
          <header className="space-y-4">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-[var(--os-text)]">
                Hola, Envasado Masivo
              </h2>
              <p className="mt-2 text-base text-[var(--os-text-muted)]">
                {viewingToday ? "Hoy" : "Viendo"}:{" "}
                <span className="font-medium text-[var(--os-text)]">
                  {formatLongDate(selectedDate)}
                </span>
              </p>
              <p className="mt-1 text-xs text-[var(--os-text-muted)]">
                Última sincronización: {formatTime(syncTime)}
              </p>
            </div>

            <DateNavigator
              selectedDate={selectedDate}
              today={today}
              onPrevious={goPrevious}
              onNext={goNext}
              onToday={goToday}
            />
          </header>

          <SummaryStrip
            paraHacer={summary.paraHacer}
            enProgreso={summary.enProgreso}
            terminadas={summary.terminadas}
            bloqueadas={summary.bloqueadas}
          />

          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-[var(--os-text)]">Trabajo del día</h3>
              <p className="mt-1 text-sm text-[var(--os-text-muted)]">
                Una card por línea — lo que hay que envasar ahora
              </p>
            </div>
            <div className="flex flex-col gap-5">
              {daySchedule.lines.map((slot) => (
                <LineWorkCard key={slot.lineId} lineId={slot.lineId} work={slot.work} />
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-[var(--os-text)]">Plan semanal</h3>
              <p className="mt-1 text-sm text-[var(--os-text-muted)]">
                Lunes a viernes · click en un día para cambiar la vista
              </p>
            </div>
            <WeekPlanStrip
              weekDays={weekDays}
              schedule={schedule}
              selectedDate={selectedDate}
              today={today}
              onSelectDate={setSelectedDate}
            />
          </section>
        </div>

        <div className="w-full shrink-0 xl:w-80">
          <ContextPanel
            upcomingDeliveries={daySchedule.upcomingDeliveries}
            problems={daySchedule.problems}
            creamyHint={creamyHint}
          />
        </div>
      </div>
    </OsShell>
  );
}
