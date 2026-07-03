"use client";

import { formatShortDay, isSameDay, isToday } from "@/features/work/lib/calendar";
import type { WeekDaySummary } from "@/features/work/lib/work-items-day-view";

interface WeekPlanStripProps {
  weekDays: WeekDaySummary[];
  selectedDate: Date;
  today: Date;
  onSelectDate: (date: Date) => void;
}

/** Plan semanal L–V desde WorkItems reales — click cambia la vista principal. */
export function WeekPlanStrip({
  weekDays,
  selectedDate,
  today,
  onSelectDate,
}: WeekPlanStripProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {weekDays.map((day) => {
        const selected = isSameDay(day.date, selectedDate);
        const isTodayDay = isToday(day.date, today);

        return (
          <button
            key={day.isoDate}
            type="button"
            onClick={() => onSelectDate(day.date)}
            className={`group flex flex-col rounded-[var(--os-radius)] border px-4 py-4 text-left transition-all ${
              selected
                ? "border-[var(--os-teal)] bg-[var(--os-teal-soft)] shadow-[var(--os-shadow-sm)] ring-1 ring-[var(--os-teal-muted)]"
                : "border-[var(--os-border)] bg-[var(--os-surface)] shadow-[var(--os-shadow-sm)] hover:border-[var(--os-teal)]/40"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-[var(--os-text)]">
                {formatShortDay(day.date)} {day.date.getDate()}
              </p>
              {isTodayDay && (
                <span className="rounded-full bg-[var(--os-teal)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                  Hoy
                </span>
              )}
            </div>

            <p className="mt-3 text-2xl font-semibold tabular-nums text-[var(--os-text)]">
              {day.jobCount}
              <span className="ml-1 text-sm font-normal text-[var(--os-text-muted)]">
                {day.jobCount === 1 ? "trabajo" : "trabajos"}
              </span>
            </p>
            <p className="mt-1 text-xs text-[var(--os-text-muted)]">
              {day.totalUnits.toLocaleString("es-AR")} u totales
            </p>
            <p className="mt-3 text-xs font-medium text-[var(--os-text-muted)] group-hover:text-[var(--os-teal)]">
              {day.statusLabel}
            </p>
          </button>
        );
      })}
    </div>
  );
}
