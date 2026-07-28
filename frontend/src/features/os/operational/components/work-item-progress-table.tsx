"use client";

import type { WorkItem } from "@/types/operational/work-item";
import { displayField } from "@/lib/operational/display-fields";
import { VIEW_ARCHIVE_TOOLTIP } from "@/lib/work-view-archive";
import {
  formatOperationalDifference,
  plannedQuantityLabel,
} from "../lib/operational-progress";
import { isWorkTransferredStatus, WORK_TRANSFER } from "../lib/work-transfer-labels";
import { ActionButton, StatusChip } from "./operational-ui";
import { DeliveryDateBadge } from "./delivery-date-badge";

interface WorkItemProgressTableProps {
  items: WorkItem[];
  variant: "envasado" | "elaboracion";
  getFinishedQty: (itemId: string) => string;
  getObservation: (itemId: string) => string;
  onSelectItem: (item: WorkItem) => void;
  emptyMessage?: string;
  /** Envasado: lista principal vs sub-pestaña Archivados. */
  listMode?: "active" | "archived";
  onArchiveFromView?: (item: WorkItem) => void;
  onRestoreToView?: (item: WorkItem) => void;
  archiveBusyId?: string | null;
}

const thClass =
  "px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--os-text-muted)] sm:px-3 sm:py-2.5";
const tdClass = "min-w-0 px-2 py-2 align-top sm:px-3 sm:py-2.5";

/** Tabla operativa — Envasado / Elaboración. La fila abre el drawer de trabajo. */
export function WorkItemProgressTable({
  items,
  variant,
  getFinishedQty,
  getObservation,
  onSelectItem,
  emptyMessage = "Sin registros.",
  listMode = "active",
  onArchiveFromView,
  onRestoreToView,
  archiveBusyId = null,
}: WorkItemProgressTableProps) {
  if (items.length === 0) {
    return (
      <p className="rounded-[var(--os-radius-sm)] border border-dashed border-[var(--os-border)] px-4 py-8 text-center text-sm text-[var(--os-text-muted)]">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="os-table-wrap overflow-x-clip rounded-[var(--os-radius-sm)] border border-[var(--os-border)]">
      <table className="os-table w-full max-w-full table-fixed border-collapse text-[length:var(--os-table-font,13px)]">
        <thead>
          <tr className="border-b border-[var(--os-border)] bg-[var(--os-bg)]">
            {variant === "envasado" && (
              <th className={`${thClass} hidden md:table-cell`}>Línea</th>
            )}
            <th className={`${thClass} hidden sm:table-cell`}>Fecha</th>
            <th className={`${thClass} hidden md:table-cell`}>Fecha de entrega</th>
            <th className={`${thClass} hidden md:table-cell`}>Cliente</th>
            <th className={thClass}>Producto</th>
            <th className={`${thClass} hidden sm:table-cell`}>
              {variant === "envasado" ? "Unidades planificadas" : "Kg planificados"}
            </th>
            <th className={`${thClass} hidden sm:table-cell`}>
              {variant === "envasado" ? "Unidades realizadas" : "Kg realizados"}
            </th>
            {variant === "envasado" && (
              <th className={`${thClass} hidden md:table-cell`}>Diferencia</th>
            )}
            <th className={thClass}>Estado</th>
            <th className={`${thClass} hidden lg:table-cell`}>Observación</th>
            <th className={thClass}>Acción</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const planned = plannedQuantityLabel(item.quantity, item.unit);
            const finishedQty = getFinishedQty(item.id);
            const diff = formatOperationalDifference(item.quantity, finishedQty);
            const isTransferred = isWorkTransferredStatus(item.status);
            const observation = getObservation(item.id);
            const busy = archiveBusyId === item.id;
            const showArchive =
              variant === "envasado" &&
              listMode === "active" &&
              isTransferred &&
              Boolean(onArchiveFromView);
            const showRestore =
              variant === "envasado" &&
              listMode === "archived" &&
              Boolean(onRestoreToView);

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
                  <td className={`${tdClass} hidden font-medium md:table-cell`}>
                    <span className="os-break">{displayField(item.line)}</span>
                  </td>
                )}
                <td className={`${tdClass} hidden sm:table-cell`}>
                  <span className="os-break">{displayField(item.dayLabel ?? item.plannedDate)}</span>
                </td>
                <td className={`${tdClass} hidden md:table-cell`}>
                  <DeliveryDateBadge deliveryDate={item.deliveryDate} />
                </td>
                <td className={`${tdClass} hidden md:table-cell`}>
                  <span className="os-break">{displayField(item.client)}</span>
                </td>
                <td className={`${tdClass} font-medium`}>
                  <span className="os-break">{displayField(item.product)}</span>
                </td>
                <td className={`${tdClass} hidden tabular-nums sm:table-cell`}>{planned}</td>
                <td className={`${tdClass} hidden tabular-nums sm:table-cell`}>{finishedQty || "—"}</td>
                {variant === "envasado" && (
                  <td
                    className={`${tdClass} hidden tabular-nums font-medium md:table-cell ${
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
                <td className={tdClass}>
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
                <td className={`${tdClass} hidden text-xs text-[var(--os-text-muted)] lg:table-cell`}>
                  <span className="os-break">{observation || "—"}</span>
                </td>
                <td className={tdClass}>
                  <div className="flex flex-col gap-1.5">
                    <ActionButton
                      label={
                        listMode === "archived"
                          ? "Ver detalle"
                          : isTransferred
                            ? "Ver detalle"
                            : "Ver / Registrar avance"
                      }
                      variant="neutral"
                      onClick={() => onSelectItem(item)}
                    />
                    {showArchive && (
                      <ActionButton
                        label="Archivar de mi vista"
                        variant="neutral"
                        disabled={busy}
                        title={VIEW_ARCHIVE_TOOLTIP}
                        onClick={() => onArchiveFromView?.(item)}
                      />
                    )}
                    {showRestore && (
                      <ActionButton
                        label="Restaurar a mi vista"
                        variant="approve"
                        disabled={busy}
                        onClick={() => onRestoreToView?.(item)}
                      />
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
