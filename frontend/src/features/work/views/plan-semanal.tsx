"use client";

import { useMemo, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { EmptyState } from "@/features/work/components/empty-state";
import { usePreviewContext, usePreviewSession } from "@/features/os/session/preview-context";
import { useSectorWorkItems } from "@/features/work/hooks/use-sector-work-items";
import {
  addDays,
  formatShortDay,
  getWorkWeekDays,
  isSameDay,
  startOfDay,
  toIsoDate,
} from "@/features/work/lib/calendar";
import { filterWorkItemsForDate } from "@/features/work/lib/work-items-day-view";
import { formatWorkItemPresentation } from "@/features/work/lib/work-items-day-view";

/** Plan semanal L–V con WorkItems reales del sector activo. */
export function WireframePlanSemanal() {
  const { applyEffectiveStatus, openWorkItem } = usePreviewContext();
  const { sectorId } = usePreviewSession();
  const { data, loading } = useSectorWorkItems(sectorId);
  const [today] = useState(() => startOfDay(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));

  const workItems = useMemo(
    () => applyEffectiveStatus(data?.workItems ?? []),
    [data?.workItems, applyEffectiveStatus]
  );

  const weekDays = useMemo(() => getWorkWeekDays(today), [today]);

  const columns = useMemo(
    () =>
      weekDays.map((date) => {
        const items = filterWorkItemsForDate(workItems, date, today);
        return {
          date,
          iso: toIsoDate(date),
          label: formatShortDay(date),
          dayNum: date.getDate(),
          isToday: isSameDay(date, today),
          isSelected: isSameDay(date, selectedDate),
          items,
        };
      }),
    [weekDays, workItems, today, selectedDate]
  );

  const selectedItems = useMemo(
    () => filterWorkItemsForDate(workItems, selectedDate, today),
    [workItems, selectedDate]
  );

  return (
    <TwinShell
      title="Plan semanal"
      syncTime={data?.scannedAt ? new Date(data.scannedAt) : undefined}
    >
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setSelectedDate((d) => addDays(d, -1))}
          className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 py-1.5 text-sm hover:border-[var(--os-teal)]"
        >
          ← Ayer
        </button>
        <button
          type="button"
          onClick={() => setSelectedDate(today)}
          className="rounded-[var(--os-radius-sm)] bg-[var(--os-teal-soft)] px-3 py-1.5 text-sm font-medium text-[var(--os-teal)]"
        >
          Hoy
        </button>
        <button
          type="button"
          onClick={() => setSelectedDate((d) => addDays(d, 1))}
          className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 py-1.5 text-sm hover:border-[var(--os-teal)]"
        >
          Mañana →
        </button>
      </div>

      {loading && <div className="os-skeleton h-96 rounded-[var(--os-radius)]" />}

      {!loading && workItems.length === 0 && (
        <EmptyState
          title="Plan sin datos"
          message="No hay WorkItems para este sector. Configurá GENUS_DATA_MODE=real y Drive."
        />
      )}

      {!loading && workItems.length > 0 && (
        <>
          <div className="grid gap-4 lg:grid-cols-5">
            {columns.map((col) => (
              <button
                key={col.iso}
                type="button"
                onClick={() => setSelectedDate(col.date)}
                className={`flex min-h-[320px] flex-col rounded-[var(--os-radius)] border p-5 text-left transition-all duration-200 hover:-translate-y-0.5 ${
                  col.isSelected
                    ? "border-[var(--os-teal)] bg-[var(--os-teal-soft)]/40 shadow-[var(--os-shadow-card)]"
                    : col.isToday
                      ? "border-[var(--os-teal)]/50 bg-[var(--os-surface)]"
                      : "border-[var(--os-border)] bg-[var(--os-surface)]"
                }`}
              >
                <p className="text-sm font-semibold uppercase tracking-wide">{col.label}</p>
                <p className="text-3xl font-light">{col.dayNum}</p>
                <p className="mt-4 text-xs text-[var(--os-text-muted)]">
                  {col.items.length} trabajo(s)
                </p>
                <ul className="mt-3 flex flex-1 flex-col gap-2">
                  {col.items.slice(0, 3).map((item) => (
                    <li
                      key={item.id}
                      className="rounded-[var(--os-radius-sm)] bg-[var(--os-bg)] px-3 py-2 text-[11px]"
                    >
                      <span className="font-semibold text-[var(--os-teal)]">
                        {item.line ?? "—"}
                      </span>
                      <span className="mt-0.5 block truncate">{item.client}</span>
                    </li>
                  ))}
                </ul>
              </button>
            ))}
          </div>

          <section className="mt-10 space-y-4">
            <h3 className="text-lg font-semibold">
              Detalle · {formatShortDay(selectedDate)} {selectedDate.getDate()}
            </h3>
            {selectedItems.length === 0 ? (
              <EmptyState
                title="Día libre"
                message="No tenés trabajos asignados para este día."
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {selectedItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openWorkItem(item.id)}
                    className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-5 py-4 text-left transition-colors hover:border-[var(--os-teal)]"
                  >
                    <p className="text-xs font-bold uppercase text-[var(--os-teal)]">
                      {item.line ?? item.sector}
                    </p>
                    <p className="mt-2 font-semibold">{item.client}</p>
                    <p className="text-sm text-[var(--os-text-muted)]">{item.product}</p>
                    <p className="mt-2 text-lg font-light">{formatWorkItemPresentation(item)}</p>
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </TwinShell>
  );
}
