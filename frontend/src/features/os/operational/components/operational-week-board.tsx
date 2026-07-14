"use client";

import type { WorkItem } from "@/types/operational/work-item";
import {
  dayOfWeekName,
  formatOperationalLongDate,
  parseIsoDate,
  weekStartMonday,
} from "@/lib/operational/operational-calendar";
import { displayField } from "@/lib/operational/display-fields";

interface OperationalWeekBoardProps {
  weekDays: string[];
  today: string;
  selectedDate: string;
  items: WorkItem[];
  onSelectDay: (iso: string) => void;
}

/** Vista Semana operativa — L–V con resalte de Hoy. */
export function OperationalWeekBoard({
  weekDays,
  today,
  selectedDate,
  items,
  onSelectDay,
}: OperationalWeekBoardProps) {
  const weekStart = weekDays[0] ?? weekStartMonday(today);
  const end = weekDays[weekDays.length - 1];
  const startParts = parseIsoDate(weekStart);
  const endParts = parseIsoDate(end ?? weekStart);

  const byDate = new Map<string, WorkItem[]>();
  for (const day of weekDays) byDate.set(day, []);
  for (const item of items) {
    if (!item.plannedDate || !byDate.has(item.plannedDate)) continue;
    byDate.get(item.plannedDate)!.push(item);
  }

  return (
    <section className="space-y-4">
      <header>
        <h3 className="text-lg font-semibold tracking-tight text-[var(--os-text)]">
          Semana · {startParts?.day}/{startParts?.month} – {endParts?.day}/{endParts?.month}
        </h3>
        <p className="text-sm text-[var(--os-text-muted)]">
          Seleccioná un día para trabajarlo en vista Día.
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-5">
        {weekDays.map((day) => {
          const dayItems = byDate.get(day) ?? [];
          const isToday = day === today;
          const isSelected = day === selectedDate;
          return (
            <button
              key={day}
              type="button"
              onClick={() => onSelectDay(day)}
              className={`rounded border px-3 py-3 text-left transition ${
                isToday
                  ? "border-emerald-600 bg-emerald-50/70"
                  : isSelected
                    ? "border-[var(--os-text)] bg-[var(--os-bg)]"
                    : "border-[var(--os-border)] hover:border-[var(--os-text-muted)]"
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{dayOfWeekName(day)}</span>
                {isToday && (
                  <span className="text-[0.65rem] font-bold uppercase tracking-wide text-emerald-800">
                    Hoy
                  </span>
                )}
              </div>
              <p className="mb-3 text-xs text-[var(--os-text-muted)]">
                {formatOperationalLongDate(day)}
              </p>
              {dayItems.length === 0 ? (
                <p className="text-xs text-[var(--os-text-muted)]">Sin trabajos</p>
              ) : (
                <ul className="space-y-2">
                  {dayItems.slice(0, 6).map((item) => (
                    <li key={item.id} className="text-xs leading-snug text-[var(--os-text)]">
                      <span className="font-medium">
                        {displayField(item.line ?? item.ownerPerson)}
                      </span>
                      <br />
                      {displayField(item.product ?? item.client)}
                      <br />
                      <span className="text-[var(--os-text-muted)]">
                        {displayField(item.quantity)}
                      </span>
                    </li>
                  ))}
                  {dayItems.length > 6 && (
                    <li className="text-[0.65rem] text-[var(--os-text-muted)]">
                      +{dayItems.length - 6} más
                    </li>
                  )}
                </ul>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
