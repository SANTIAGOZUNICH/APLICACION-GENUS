"use client";

import {
  formatShortDay,
  isSameDay,
  isToday,
  toIsoDate,
} from "@/design-preview/lib/calendar-mock";
import type { MasivoDaySchedule } from "@/design-preview/mock-data/envasado-masivo-schedule";

interface WeekPlanStripProps {
  weekDays: Date[];
  schedule: Map<string, MasivoDaySchedule>;
  selectedDate: Date;
  today: Date;
  onSelectDate: (date: Date) => void;
}

/** Plan semanal L–V — click cambia la vista principal. */
export function WeekPlanStrip({
  weekDays,
  schedule,
  selectedDate,
  today,
  onSelectDate,
}: WeekPlanStripProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {weekDays.map((day) => {
        const iso = toIsoDate(day);
        const daySchedule = schedule.get(iso);
        const selected = isSameDay(day, selectedDate);
        const isTodayDay = isToday(day, today);

        return (
          <button
            key={iso}
            type="button"
            onClick={() => onSelectDate(day)}
            className={`group flex flex-col rounded-[var(--os-radius)] border px-4 py-4 text-left transition-all ${
              selected
                ? "border-[var(--os-teal)] bg-[var(--os-teal-soft)] shadow-[var(--os-shadow-sm)] ring-1 ring-[var(--os-teal-muted)]"
                : "border-[var(--os-border)] bg-[var(--os-surface)] shadow-[var(--os-shadow-sm)] hover:border-[var(--os-teal)]/40"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-[var(--os-text)]">
                {formatShortDay(day)} {day.getDate()}
              </p>
              {isTodayDay && (
                <span className="rounded-full bg-[var(--os-teal)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                  Hoy
                </span>
              )}
            </div>

            <p className="mt-3 text-2xl font-semibold tabular-nums text-[var(--os-text)]">
              {daySchedule?.jobCount ?? 0}
              <span className="ml-1 text-sm font-normal text-[var(--os-text-muted)]">
                {daySchedule?.jobCount === 1 ? "trabajo" : "trabajos"}
              </span>
            </p>
            <p className="mt-1 text-xs text-[var(--os-text-muted)]">
              {(daySchedule?.totalUnits ?? 0).toLocaleString("es-AR")} u totales
            </p>
            <p className="mt-3 text-xs font-medium text-[var(--os-text-muted)] group-hover:text-[var(--os-teal)]">
              {daySchedule?.statusLabel ?? "Sin datos"}
            </p>
          </button>
        );
      })}
    </div>
  );
}
