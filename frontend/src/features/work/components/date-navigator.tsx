"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatLongDate, isSameDay } from "@/design-preview/lib/calendar";

interface DateNavigatorProps {
  selectedDate: Date;
  today: Date;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  sourceLabel?: string;
}

/** Selector de día — resuelve bloque SEMANAS 2026 del día seleccionado. */
export function DateNavigator({
  selectedDate,
  today,
  onPrevious,
  onNext,
  onToday,
  sourceLabel,
}: DateNavigatorProps) {
  const isTodaySelected = isSameDay(selectedDate, today);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1 rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] p-1 shadow-[var(--os-shadow-sm)]">
        <button
          type="button"
          onClick={onPrevious}
          className="rounded-md p-2 text-[var(--os-text-muted)] transition-colors hover:bg-[var(--os-bg)] hover:text-[var(--os-text)]"
          aria-label="Día anterior"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="min-w-[14rem] px-2 text-center text-sm font-medium text-[var(--os-text)]">
          {formatLongDate(selectedDate)}
        </span>
        <button
          type="button"
          onClick={onNext}
          className="rounded-md p-2 text-[var(--os-text-muted)] transition-colors hover:bg-[var(--os-bg)] hover:text-[var(--os-text)]"
          aria-label="Día siguiente"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <button
        type="button"
        onClick={onToday}
        disabled={isTodaySelected}
        className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-4 py-2 text-sm font-medium text-[var(--os-text)] shadow-[var(--os-shadow-sm)] transition-colors hover:border-[var(--os-teal)] hover:text-[var(--os-teal)] disabled:cursor-default disabled:border-[var(--os-teal-muted)] disabled:bg-[var(--os-teal-soft)] disabled:text-[var(--os-teal)]"
      >
        Hoy
      </button>

      {sourceLabel && (
        <span className="text-xs text-[var(--os-text-muted)]">{sourceLabel}</span>
      )}
    </div>
  );
}
