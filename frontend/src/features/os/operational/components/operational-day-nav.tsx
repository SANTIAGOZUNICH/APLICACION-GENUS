"use client";

import {
  addDaysIso,
  dayOfWeekName,
  formatOperationalLongDate,
  parseIsoDate,
} from "@/lib/operational/operational-calendar";
import type { TemporalViewMode } from "../hooks/use-operational-calendar";

interface OperationalDayNavProps {
  selectedDate: string;
  today: string;
  viewMode: TemporalViewMode;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onViewMode: (mode: TemporalViewMode) => void;
}

function shortLabel(iso: string): string {
  const parts = parseIsoDate(iso);
  if (!parts) return iso;
  return `${dayOfWeekName(iso)} ${parts.day}`;
}

/** Navegación temporal compacta — prioriza trabajo del día, no agenda. */
export function OperationalDayNav({
  selectedDate,
  today,
  viewMode,
  onPrev,
  onNext,
  onToday,
  onViewMode,
}: OperationalDayNavProps) {
  const prev = addDaysIso(selectedDate, -1);
  const next = addDaysIso(selectedDate, 1);
  const isToday = selectedDate === today;

  return (
    <div className="mb-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onViewMode("day")}
          className={`rounded px-3 py-1.5 text-sm font-medium ${
            viewMode === "day"
              ? "bg-[var(--os-text)] text-[var(--os-bg)]"
              : "text-[var(--os-text-muted)] hover:text-[var(--os-text)]"
          }`}
        >
          Día
        </button>
        <button
          type="button"
          onClick={() => onViewMode("week")}
          className={`rounded px-3 py-1.5 text-sm font-medium ${
            viewMode === "week"
              ? "bg-[var(--os-text)] text-[var(--os-bg)]"
              : "text-[var(--os-text-muted)] hover:text-[var(--os-text)]"
          }`}
        >
          Semana
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          aria-label="Día anterior"
          onClick={onPrev}
          className="rounded border border-[var(--os-border)] px-2.5 py-1.5 text-[var(--os-text)] hover:bg-[var(--os-bg)]"
        >
          ←
        </button>

        <span className="text-[var(--os-text-muted)]">{shortLabel(prev)}</span>

        <button
          type="button"
          onClick={onToday}
          className={`rounded px-3 py-1.5 font-semibold ${
            isToday
              ? "bg-emerald-700 text-white"
              : "border border-[var(--os-border)] text-[var(--os-text)] hover:bg-[var(--os-bg)]"
          }`}
        >
          Hoy
        </button>

        <span className="min-w-[10rem] text-center font-medium text-[var(--os-text)]">
          {formatOperationalLongDate(selectedDate)}
        </span>

        <span className="text-[var(--os-text-muted)]">{shortLabel(next)}</span>

        <button
          type="button"
          aria-label="Día siguiente"
          onClick={onNext}
          className="rounded border border-[var(--os-border)] px-2.5 py-1.5 text-[var(--os-text)] hover:bg-[var(--os-bg)]"
        >
          →
        </button>
      </div>
    </div>
  );
}
