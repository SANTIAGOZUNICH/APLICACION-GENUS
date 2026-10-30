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
import { WorkItemEditDeleteActions } from "@/features/os/operational/components/work-item-edit-delete-actions";
import { ActionButton, ExcelOrList, excelCol } from "@/features/os/operational/components/operational-ui";
import { useWorkItemCellEditing } from "@/features/os/operational/hooks/use-work-item-cells";
import { formatDateDisplay } from "@/features/os/operational/lib/delivery-date";
import type { WorkItem } from "@/types/operational/work-item";
import { OperationalMonthBoard } from "@/features/os/operational/components/operational-month-board";
import { MoveConfirmDialog, usePendingMove } from "@/features/os/operational/components/move-confirm";
import { addMonths, monthLabel, monthStartOf } from "@/lib/operational/month-grid";
import type { SectorId } from "@/types/operational/sector";

/** Plan semanal L–V con WorkItems reales del sector activo. */
export function WireframePlanSemanal() {
  const { applyEffectiveStatus, openWorkItem, showToast } = usePreviewContext();
  const { sectorId, email } = usePreviewSession();
  const { data, loading, refresh } = useSectorWorkItems(sectorId);
  const [today] = useState(() => startOfDay(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  // Semanal | Mensual: la MISMA planificación del sector con otra perspectiva (no crea ni duplica trabajos).
  const [mode, setMode] = useState<"semana" | "mes">("semana");
  const [monthAnchor, setMonthAnchor] = useState(() => monthStartOf(toIsoDate(startOfDay(new Date()))));
  const canReschedule = sectorId === "PRODUCCION" || sectorId === "DIRECCION";
  const move = usePendingMove({
    actorSectorId: sectorId as SectorId,
    updatedBy: email ?? "Producción",
    onSaved: () => {
      showToast("Planificación actualizada.");
      refresh();
    },
    onError: (m) => showToast(m, "info"),
  });

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
    [workItems, selectedDate, today]
  );

  // Detalle del día como planilla: mismas columnas/política que las tablas de trabajos (PATCH por celda).
  const cells = useWorkItemCellEditing(selectedItems, refresh);
  const detailColumns = useMemo(
    () => [
      excelCol<WorkItem>("linea", "Línea", (i) => i.line ?? i.sector),
      excelCol<WorkItem>("plannedDate", "Fecha", (i) => (i.plannedDate ? formatDateDisplay(i.plannedDate) : i.dayLabel ?? ""), { edit: cells.edit("plannedDate") }),
      excelCol<WorkItem>("deliveryDate", "Entrega", (i) => (i.deliveryDate ? formatDateDisplay(i.deliveryDate) : ""), { edit: cells.edit("deliveryDate") }),
      excelCol<WorkItem>("client", "Cliente", (i) => i.client ?? "", { edit: cells.edit("client") }),
      excelCol<WorkItem>("product", "Producto", (i) => i.product ?? "", { edit: cells.edit("product") }),
      excelCol<WorkItem>("plannedQuantity", "Cantidad", (i) => i.quantity ?? "", { edit: cells.edit("plannedQuantity") }),
      excelCol<WorkItem>("unit", "Unidad", (i) => i.unit ?? "", { edit: cells.edit("unit") }),
      excelCol<WorkItem>("estado", "Estado", (i) => i.status.replace(/_/g, " ")),
      excelCol<WorkItem>("notes", "Observación", (i) => i.notes ?? "", { edit: cells.edit("notes") }),
      {
        key: "acciones",
        header: "Acción",
        action: true,
        text: () => "",
        render: (i: WorkItem) => (
          <ActionButton label="Abrir trabajo" variant="neutral" onClick={() => openWorkItem(i.id)} />
        ),
      },
    ],
    [cells, openWorkItem]
  );

  return (
    <TwinShell
      title="Plan semanal"
      syncTime={data?.scannedAt ? new Date(data.scannedAt) : undefined}
    >
      <div className="mb-4 flex gap-2" role="tablist" aria-label="Vista">
        {([["semana", "Semanal"], ["mes", "Mensual"]] as const).map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            data-testid={`plan-mode-${m}`}
            onClick={() => setMode(m)}
            className={`rounded-[var(--os-radius-sm)] px-3 py-1.5 text-sm font-medium ${mode === m ? "bg-[var(--os-teal)] text-[var(--os-navy)]" : "border border-[var(--os-border)]"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "mes" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" aria-label="Mes anterior" onClick={() => setMonthAnchor((m) => addMonths(m, -1))} className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 py-1.5 text-sm">← Mes anterior</button>
            <button type="button" onClick={() => setMonthAnchor(monthStartOf(toIsoDate(today)))} className="rounded-[var(--os-radius-sm)] bg-[var(--os-teal-soft)] px-3 py-1.5 text-sm font-medium text-[var(--os-teal)]">Mes actual</button>
            <button type="button" aria-label="Mes siguiente" onClick={() => setMonthAnchor((m) => addMonths(m, 1))} className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 py-1.5 text-sm">Mes siguiente →</button>
            <h3 className="text-lg font-semibold capitalize" data-testid="plan-month-title">{monthLabel(monthAnchor)}</h3>
          </div>
          {loading ? (
            <div className="os-skeleton h-96 rounded-[var(--os-radius)]" />
          ) : (
            <OperationalMonthBoard
              monthStart={monthAnchor}
              today={toIsoDate(today)}
              items={workItems}
              allItems={workItems}
              canEdit={canReschedule}
              onSelectItem={(item) => openWorkItem(item.id)}
              onRequestDate={canReschedule ? (item, plannedDate) => move.request({ item, plannedDate }) : undefined}
            />
          )}
          <MoveConfirmDialog pending={move.pending} busy={move.busy} onConfirm={() => void move.confirm()} onCancel={move.cancel} />
        </div>
      ) : null}

      <div className={`mb-8 flex flex-wrap items-center gap-3 ${mode === "mes" ? "hidden" : ""}`}>
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

      {mode === "semana" && loading && <div className="os-skeleton h-96 rounded-[var(--os-radius)]" />}

      {mode === "semana" && !loading && workItems.length === 0 && (
        <EmptyState
          title="No hay trabajos para este día"
          message="Probá con «Mañana» o «Ayer». Si esperabas ver trabajos acá, avisale a Producción."
        />
      )}

      {mode === "semana" && !loading && workItems.length > 0 && (
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
              <ExcelOrList
                columns={detailColumns}
                rows={selectedItems}
                rowKey={(i) => i.id}
                tableId="plan-semanal-detalle"
                canEditCells={cells.canEditCells}
                onCellsCommit={cells.onCellsCommit}
                rowVersion={cells.rowVersion}
                reasonRequired={cells.reasonRequired}
              >
              <div className="grid gap-3 sm:grid-cols-2">
                {selectedItems.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-5 py-4 transition-colors hover:border-[var(--os-teal)]"
                  >
                    <button
                      type="button"
                      onClick={() => openWorkItem(item.id)}
                      className="w-full text-left"
                    >
                      <p className="text-xs font-bold uppercase text-[var(--os-teal)]">
                        {item.line ?? item.sector}
                      </p>
                      <p className="mt-2 font-semibold">{item.client}</p>
                      <p className="text-sm text-[var(--os-text-muted)]">{item.product}</p>
                      <p className="mt-2 text-lg font-light">{formatWorkItemPresentation(item)}</p>
                    </button>
                    <div className="mt-3">
                      <WorkItemEditDeleteActions item={item} actorSectorId={sectorId} actorName={email} />
                    </div>
                  </div>
                ))}
              </div>
              </ExcelOrList>
            )}
          </section>
        </>
      )}
    </TwinShell>
  );
}
