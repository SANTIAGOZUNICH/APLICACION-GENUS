"use client";

import {
  addDaysIso,
  dayOfWeekName,
  formatOperationalLongDate,
  parseIsoDate,
  weekStartMonday,
} from "@/lib/operational/operational-calendar";
import type { TemporalViewMode } from "../hooks/use-operational-calendar";

interface OperationalDayNavProps {
  selectedDate: string;
  today: string;
  viewMode: TemporalViewMode;
  /** Día anterior/siguiente — usado cuando viewMode === "day". */
  onPrev: () => void;
  onNext: () => void;
  /** Exactamente ±1 semana — usado cuando viewMode === "week". Si se omite, las flechas caen a onPrev/onNext (±1 día). */
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
  onToday: () => void;
  /** "Hoy"/"Semana actual" en modo Semana — vuelve a la semana de hoy sin resetear a vista Día. Si se omite, cae a onToday (día). */
  onTodayWeek?: () => void;
  /** Vista Mensual (opcional: sin estas props el selector no muestra «Mes»). */
  monthTitle?: string;
  onPrevMonth?: () => void;
  onNextMonth?: () => void;
  onTodayMonth?: () => void;
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
  onPrevWeek,
  onNextWeek,
  onToday,
  onTodayWeek,
  monthTitle,
  onPrevMonth,
  onNextMonth,
  onTodayMonth,
  onViewMode,
}: OperationalDayNavProps) {
  const isMonth = viewMode === "month" && Boolean(onPrevMonth && onNextMonth);
  const isWeek = !isMonth && viewMode === "week" && onPrevWeek && onNextWeek;
  const prev = addDaysIso(selectedDate, -1);
  const next = addDaysIso(selectedDate, 1);
  const weekStart = weekStartMonday(selectedDate);
  const isToday = isMonth ? selectedDate.slice(0, 7) === today.slice(0, 7) : isWeek ? weekStart === weekStartMonday(today) : selectedDate === today;
  const weekEnd = addDaysIso(weekStart, 6);
  const weekStartParts = parseIsoDate(weekStart);
  const weekEndParts = parseIsoDate(weekEnd);
  const weekRangeLabel = `Semana ${weekStartParts?.day}/${weekStartParts?.month} – ${weekEndParts?.day}/${weekEndParts?.month}`;

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
        {onPrevMonth && onNextMonth ? (
          <button
            type="button"
            onClick={() => onViewMode("month")}
            data-testid="view-mode-month"
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              viewMode === "month"
                ? "bg-[var(--os-text)] text-[var(--os-bg)]"
                : "text-[var(--os-text-muted)] hover:text-[var(--os-text)]"
            }`}
          >
            Mes
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          aria-label={isMonth ? "Mes anterior" : isWeek ? "Semana anterior" : "Día anterior"}
          onClick={isMonth ? onPrevMonth : isWeek ? onPrevWeek : onPrev}
          className="rounded border border-[var(--os-border)] px-2.5 py-1.5 text-[var(--os-text)] hover:bg-[var(--os-bg)]"
        >
          ←
        </button>

        {!isWeek && !isMonth && <span className="text-[var(--os-text-muted)]">{shortLabel(prev)}</span>}

        <button
          type="button"
          onClick={isMonth ? (onTodayMonth ?? onToday) : isWeek ? (onTodayWeek ?? onToday) : onToday}
          className={`rounded px-3 py-1.5 font-semibold ${
            isToday
              ? "bg-emerald-700 text-white"
              : "border border-[var(--os-border)] text-[var(--os-text)] hover:bg-[var(--os-bg)]"
          }`}
        >
          {isMonth ? "Mes actual" : isWeek ? "Semana actual" : "Hoy"}
        </button>

        <span className="min-w-[10rem] text-center font-medium text-[var(--os-text)]">
          {isMonth ? <span data-testid="month-title" className="capitalize">{monthTitle}</span> : isWeek ? weekRangeLabel : formatOperationalLongDate(selectedDate)}
        </span>

        {!isWeek && !isMonth && <span className="text-[var(--os-text-muted)]">{shortLabel(next)}</span>}

        <button
          type="button"
          aria-label={isMonth ? "Mes siguiente" : isWeek ? "Semana siguiente" : "Día siguiente"}
          onClick={isMonth ? onNextMonth : isWeek ? onNextWeek : onNext}
          className="rounded border border-[var(--os-border)] px-2.5 py-1.5 text-[var(--os-text)] hover:bg-[var(--os-bg)]"
        >
          →
        </button>
      </div>
    </div>
  );
}
