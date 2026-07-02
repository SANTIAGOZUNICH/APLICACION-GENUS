"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/design-preview/components/empty-state";
import { TwinShell } from "@/design-preview/components/twin-shell";
import { useSectorWorkItems } from "@/design-preview/hooks/use-sector-work-items";
import {
  addDays,
  formatLongDate,
  formatTime,
  getWorkWeekDays,
  isSameDay,
  startOfDay,
} from "@/design-preview/lib/calendar";
import { usePreviewContext, usePreviewSession } from "@/design-preview/lib/preview-context";
import { displayField } from "@/lib/operational/display-fields";
import { filterWorkItemsForDate } from "@/design-preview/lib/work-items-day-view";

/** Elaboración por persona — bloques visuales SEMANAS, sin agrupar en React. */
export function WireframeElaboracion() {
  const { ownerPerson, email } = usePreviewSession();
  const { openWorkItem, openOe, applyEffectiveStatus } = usePreviewContext();
  const [today] = useState(() => startOfDay(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const { data, loading, error } = useSectorWorkItems("ELABORACION", { ownerPerson });

  const greetingName = ownerPerson ?? "Elaboración";
  const workItems = useMemo(
    () => applyEffectiveStatus(data?.workItems ?? []),
    [data?.workItems, applyEffectiveStatus]
  );
  const dayItems = useMemo(
    () => filterWorkItemsForDate(workItems, selectedDate, today),
    [workItems, selectedDate, today]
  );
  const scannedAt = data?.scannedAt ? new Date(data.scannedAt) : null;
  const viewingToday = isSameDay(selectedDate, today);
  const weekDays = useMemo(() => getWorkWeekDays(today), [today]);

  return (
    <TwinShell contentClassName="max-w-3xl">
      <header className="mb-10 space-y-3">
        <h2 className="text-3xl font-semibold tracking-tight text-[var(--os-text)]">
          Hola {greetingName}
        </h2>
        <p className="text-base text-[var(--os-text-muted)]">
          {viewingToday ? "Hoy" : "Viendo"}:{" "}
          <span className="font-medium text-[var(--os-text)]">{formatLongDate(selectedDate)}</span>
        </p>
        <p className="text-xs text-[var(--os-text-muted)]">
          {email} · SEMANAS 2026 · sync {scannedAt ? formatTime(scannedAt) : "—"}
        </p>
      </header>

      <div className="mb-8 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSelectedDate((d) => addDays(d, -1))}
          className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 py-1.5 text-sm"
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
          className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 py-1.5 text-sm"
        >
          Mañana →
        </button>
      </div>

      {loading && <div className="os-skeleton h-40 rounded-[var(--os-radius)]" />}

      {error && (
        <div className="rounded-[var(--os-radius)] border border-rose-200 bg-rose-50 px-6 py-4 text-sm text-rose-900">
          {error}
        </div>
      )}

      {!loading && !error && data?.message && workItems.length === 0 && (
        <EmptyState
          title={`Sin trabajos para ${greetingName}`}
          message={data.message}
        />
      )}

      {!loading && !error && dayItems.length === 0 && workItems.length > 0 && (
        <EmptyState
          title="Sin elaboraciones este día"
          message={`No tenés trabajos asignados para ${formatLongDate(selectedDate)}.`}
        />
      )}

      {!loading && !error && dayItems.length > 0 && (
        <section className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold text-[var(--os-text)]">
              {viewingToday ? "Hoy elaborás" : "Elaboraciones del día"}
            </h3>
            <p className="mt-1 text-sm text-[var(--os-text-muted)]">
              {dayItems.length} producto(s) · bloque {greetingName} en SEMANAS
            </p>
          </div>

          <ul className="space-y-3">
            {dayItems.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => openWorkItem(item.id)}
                  className="group flex w-full items-start gap-4 rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] px-6 py-5 text-left transition-all hover:-translate-y-0.5 hover:border-[var(--os-teal)] hover:shadow-[var(--os-shadow-card)]"
                >
                  <span className="mt-1 text-[var(--os-teal)]">•</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xl font-semibold tracking-tight text-[var(--os-text)]">
                      {displayField(item.product)}
                    </p>
                    <p className="mt-1 text-sm text-[var(--os-text-muted)]">
                      {displayField(item.client)} · {displayField(item.quantity)}
                      {item.unit ? ` ${item.unit}` : ""}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-4 text-xs text-[var(--os-text-muted)]">
                      <span>OE · {displayField(item.oeRef)}</span>
                      <span>Entrega · {displayField(item.deliveryDate ?? item.dayLabel)}</span>
                    </div>
                  </div>
                  {item.oeRef && (
                    <span
                      role="presentation"
                      onClick={(e) => {
                        e.stopPropagation();
                        openOe(item.oeRef!, item.id);
                      }}
                      className="shrink-0 text-sm font-medium text-[var(--os-teal)] opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      Ver OE
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!loading && weekDays.length > 0 && (
        <p className="mt-12 text-xs text-[var(--os-text-muted)]">
          Semana laboral · {weekDays.length} días · datos desde SEMANAS 2026
        </p>
      )}
    </TwinShell>
  );
}
