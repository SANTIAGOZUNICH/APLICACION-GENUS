"use client";

import type { WorkItem } from "@/types/operational/work-item";
import { displayField } from "@/lib/operational/display-fields";
import {
  formatOperationalDifference,
  plannedQuantityLabel,
} from "../lib/operational-progress";
import { isWorkTransferredStatus, WORK_TRANSFER } from "../lib/work-transfer-labels";
import { ActionButton, StatusChip } from "./operational-ui";

interface WorkItemProgressTableProps {
  items: WorkItem[];
  variant: "envasado" | "elaboracion";
  getFinishedQty: (itemId: string) => string;
  getObservation: (itemId: string) => string;
  onSelectItem: (item: WorkItem) => void;
  emptyMessage?: string;
}

/** Tabla operativa — Envasado / Elaboración. La fila abre el drawer de trabajo. */
export function WorkItemProgressTable({
  items,
  variant,
  getFinishedQty,
  getObservation,
  onSelectItem,
  emptyMessage = "Sin registros.",
}: WorkItemProgressTableProps) {
  if (items.length === 0) {
    return (
      <p className="rounded-[var(--os-radius-sm)] border border-dashed border-[var(--os-border)] px-4 py-8 text-center text-sm text-[var(--os-text-muted)]">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[var(--os-radius-sm)] border border-[var(--os-border)]">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--os-border)] bg-[var(--os-bg)]">
            {variant === "envasado" && (
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
                Línea
              </th>
            )}
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
              Fecha
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
              Cliente
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
              Producto
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
              {variant === "envasado" ? "Unidades planificadas" : "Kg planificados"}
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
              {variant === "envasado" ? "Unidades realizadas" : "Kg realizados"}
            </th>
            {variant === "envasado" && (
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
                Diferencia
              </th>
            )}
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
              Estado
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
              Observación
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
              Acción
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const planned = plannedQuantityLabel(item.quantity, item.unit);
            const finishedQty = getFinishedQty(item.id);
            const diff = formatOperationalDifference(item.quantity, finishedQty);
            const isTransferred = isWorkTransferredStatus(item.status);
            const observation = getObservation(item.id);

            return (
              <tr
                key={item.id}
                onClick={() => onSelectItem(item)}
                className={`cursor-pointer border-b border-[var(--os-border-subtle)] last:border-b-0 ${
                  isTransferred
                    ? "border-l-4 border-l-[var(--os-teal)] bg-[var(--os-teal-soft)]/40"
                    : "hover:bg-[var(--os-bg)]/60"
                }`}
              >
                {variant === "envasado" && (
                  <td className="px-3 py-2.5 align-top font-medium">
                    {displayField(item.line)}
                  </td>
                )}
                <td className="px-3 py-2.5 align-top">
                  {displayField(item.dayLabel ?? item.plannedDate)}
                </td>
                <td className="px-3 py-2.5 align-top">{displayField(item.client)}</td>
                <td className="px-3 py-2.5 align-top font-medium">
                  {displayField(item.product)}
                </td>
                <td className="px-3 py-2.5 align-top tabular-nums">{planned}</td>
                <td className="px-3 py-2.5 align-top tabular-nums">{finishedQty || "—"}</td>
                {variant === "envasado" && (
                  <td
                    className={`px-3 py-2.5 align-top tabular-nums font-medium ${
                      diff.startsWith("+")
                        ? "text-emerald-700"
                        : diff.startsWith("-")
                          ? "text-rose-700"
                          : ""
                    }`}
                  >
                    {diff}
                  </td>
                )}
                <td className="px-3 py-2.5 align-top">
                  {isTransferred ? (
                    <div className="space-y-1">
                      <StatusChip status={item.status} />
                      <p className="text-xs font-medium text-[var(--os-teal)]">
                        {WORK_TRANSFER.deliveredToQuality}
                      </p>
                    </div>
                  ) : (
                    <StatusChip status={item.status} />
                  )}
                </td>
                <td className="px-3 py-2.5 align-top max-w-[220px] truncate text-xs text-[var(--os-text-muted)]">
                  {observation || "—"}
                </td>
                <td className="px-3 py-2.5 align-top">
                  <ActionButton
                    label={isTransferred ? "Ver detalle" : "Ver / Registrar avance"}
                    variant="neutral"
                    onClick={() => onSelectItem(item)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
