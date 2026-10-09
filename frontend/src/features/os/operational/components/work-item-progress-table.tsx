"use client";

import { NEUTRAL_PRIORITY_TEXT, priorityEdge, WorkItemPriorityBadge } from "./work-item-priority-badge";
import { useWorkItemPrioritiesAvailable, useWorkItemPrioritiesMap } from "../hooks/use-work-item-priorities";
import { PRIORITY_META } from "@/lib/semanas-sheet/priorities";
import type { WorkItem } from "@/types/operational/work-item";
import { displayField } from "@/lib/operational/display-fields";
import { VIEW_ARCHIVE_TOOLTIP } from "@/lib/work-view-archive";
import {
  formatOperationalDifference,
  plannedQuantityLabel,
} from "../lib/operational-progress";
import { isWorkTransferredStatus, WORK_TRANSFER } from "../lib/work-transfer-labels";
import { ActionButton, ExcelOrList, excelCol, StatusChip } from "./operational-ui";
import { useWorkItemCellEditing } from "../hooks/use-work-item-cells";
import { formatDateDisplay } from "../lib/delivery-date";
import { DeliveryDateBadge } from "./delivery-date-badge";
import { WorkItemWarningBadge } from "./work-item-warning-badge";
import { WorkItemCards } from "./work-item-cards";
import { useWorkItemsView } from "../hooks/use-work-items-view";

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
  /** Agrega columnas Lote/VTO/OA — usado por Pendientes, donde esos datos son parte de lo mínimo a mostrar. */
  showPackagingColumns?: boolean;
  /** Recarga la lista tras una edición por celda (el servidor ya confirmó). */
  onItemsChanged?: () => void | Promise<void>;
}

const thClass = "os-table-th";
const tdClass = "os-table-td";

/** Tabla operativa — Envasado / Elaboración. La fila abre el drawer de trabajo. */
type CellEditing = ReturnType<typeof useWorkItemCellEditing>;
const NO_CELL_EDITING: CellEditing = {
  canEditCells: undefined,
  onCellsCommit: undefined,
  rowVersion: undefined,
  reasonRequired: undefined,
  edit: () => undefined,
} as unknown as CellEditing;

function EditableWorkItemTable(props: WorkItemProgressTableProps) {
  const cells = useWorkItemCellEditing(props.items, props.onItemsChanged);
  return <WorkItemProgressTableInner {...props} cells={cells} />;
}

/** Con `onItemsChanged` la lista es editable por celda (requiere WorkspaceProvider); sin él, solo lectura. */
export function WorkItemProgressTable(props: WorkItemProgressTableProps) {
  return props.onItemsChanged ? <EditableWorkItemTable {...props} /> : <WorkItemProgressTableInner {...props} />;
}

function WorkItemProgressTableInner({
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
  showPackagingColumns = false,
  cells: cellsIn,
}: WorkItemProgressTableProps & { cells?: CellEditing }) {
  const cells = cellsIn ?? NO_CELL_EDITING;
  const [view, setView] = useWorkItemsView();
  // Prioridad de Semanas (solo trabajos vinculados por Producción). Solo lectura: la cambia Producción en Semanas.
  const semanasPriorities = useWorkItemPrioritiesMap();
  // Con la función disponible se muestra siempre la columna: vinculado = prioridad; sin vínculo = indicación neutral.
  const showPriority = useWorkItemPrioritiesAvailable();
  if (items.length === 0) {
    return (
      <p className="rounded-[var(--os-radius-sm)] border border-dashed border-[var(--os-border)] px-4 py-8 text-center text-sm text-[var(--os-text-muted)]">
        {emptyMessage}
      </p>
    );
  }

  // Planilla tipo Excel (seleccionar/copiar rangos); la lista clásica queda como «Ver como lista».
  const excelColumns = [
    ...(showPriority
      ? [
          excelCol<WorkItem>("semanasPriority", "Prioridad", (i) => {
            const p = semanasPriorities[i.id]?.priority;
            return p ? `${PRIORITY_META[p].icon} ${PRIORITY_META[p].label}` : `⚪ ${NEUTRAL_PRIORITY_TEXT}`;
          }),
        ]
      : []),
    // Responsable (Elaboración) / Línea (Envasado): editable por Producción con versión y auditoría.
    excelCol<WorkItem>("assignee", variant === "envasado" ? "Línea" : "Responsable", (i) => (variant === "envasado" ? (i.line ?? "") : (i.ownerPerson ?? "")), { edit: cells.edit("assignee") }),
    excelCol<WorkItem>("plannedDate", "Fecha", (i) => (i.plannedDate ? formatDateDisplay(i.plannedDate) : displayField(i.dayLabel)), { edit: cells.edit("plannedDate") }),
    excelCol<WorkItem>("deliveryDate", "Fecha de entrega", (i) => (i.deliveryDate ? formatDateDisplay(i.deliveryDate) : ""), { edit: cells.edit("deliveryDate") }),
    excelCol<WorkItem>("client", "Cliente", (i) => i.client ?? "", { edit: cells.edit("client") }),
    excelCol<WorkItem>("product", "Producto", (i) => i.product ?? "", { edit: cells.edit("product") }),
    excelCol<WorkItem>("plannedQuantity", variant === "envasado" ? "Unidades planificadas" : "Kg planificados", (i) => i.quantity ?? "", { edit: cells.edit("plannedQuantity") }),
    excelCol<WorkItem>("unit", "Unidad", (i) => i.unit ?? "", { edit: cells.edit("unit") }),
    excelCol<WorkItem>("realizado", variant === "envasado" ? "Unidades realizadas" : "Kg realizados", (i) => getFinishedQty(i.id) || "—"),
    ...(variant === "envasado" ? [excelCol<WorkItem>("diferencia", "Diferencia", (i) => formatOperationalDifference(i.quantity, getFinishedQty(i.id)))] : []),
    ...(showPackagingColumns
      ? [
          excelCol<WorkItem>("packagingLote", "Lote", (i) => i.packagingLote ?? i.loteRef ?? "", { edit: cells.edit("packagingLote") }),
          excelCol<WorkItem>("packagingVto", "VTO", (i) => (i.packagingVto ? formatDateDisplay(i.packagingVto) : ""), { edit: cells.edit("packagingVto") }),
          excelCol<WorkItem>("oa", "OA", (i) => displayField(i.oaRef)),
        ]
      : []),
    excelCol<WorkItem>("estado", "Estado", (i) => i.status.replace(/_/g, " ")),
    excelCol<WorkItem>("notes", "Observación", (i) => i.notes ?? "", { edit: cells.edit("notes") }),
    excelCol<WorkItem>("avance", "Avance informado", (i) => getObservation(i.id) || "—"),
    {
      key: "acciones",
      header: "Acción",
      action: true,
      text: () => "",
      render: (i: WorkItem) => (
        <ActionButton
          label={listMode === "archived" || isWorkTransferredStatus(i.status) ? "Ver detalle" : "Ver / Registrar avance"}
          variant="neutral"
          onClick={() => onSelectItem(i)}
        />
      ),
    },
  ];

  const viewToggle = (
    <div className="flex justify-end">
      <div className="inline-flex rounded-lg border border-[var(--os-border)] p-0.5 text-xs" role="tablist" aria-label="Vista de trabajos">
        {(["cards", "planilla"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            data-testid={`work-items-view-${v}`}
            className={`rounded-md px-2.5 py-1 font-semibold ${view === v ? "bg-[var(--os-teal)] text-[#04201e]" : "text-[var(--os-text-muted)] hover:text-[var(--os-text)]"}`}
          >
            {v === "cards" ? "Tarjetas" : "Planilla"}
          </button>
        ))}
      </div>
    </div>
  );
  if (view === "cards") {
    return (
      <div className="space-y-2">
        {viewToggle}
        <WorkItemCards
          items={items}
          variant={variant}
          getFinishedQty={getFinishedQty}
          getObservation={getObservation}
          onSelectItem={onSelectItem}
          listMode={listMode}
          onArchiveFromView={onArchiveFromView}
          onRestoreToView={onRestoreToView}
          archiveBusyId={archiveBusyId}
          showPackagingColumns={showPackagingColumns}
          cells={cells}
        />
      </div>
    );
  }
  return (
    <div className="space-y-2">
    {viewToggle}
    <ExcelOrList
      columns={excelColumns}
      rows={items}
      rowKey={(i) => i.id}
      tableId={`work-items-${variant}`}
      canEditCells={cells.canEditCells}
      onCellsCommit={cells.onCellsCommit}
      rowVersion={cells.rowVersion}
      reasonRequired={cells.reasonRequired}
      rowClassName={showPriority ? (i) => `genus-row-prio-${semanasPriorities[i.id]?.priority ?? "NONE"}` : undefined}
    >
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
            {showPackagingColumns && (
              <>
                <th className={`${thClass} hidden lg:table-cell`}>Lote</th>
                <th className={`${thClass} hidden lg:table-cell`}>VTO</th>
                <th className={`${thClass} hidden lg:table-cell`}>OA</th>
              </>
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
                data-semanas-priority={semanasPriorities[item.id]?.priority ?? (showPriority ? "NONE" : undefined)}
                style={isTransferred ? undefined : priorityEdge(semanasPriorities[item.id]?.priority)}
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
                  <WorkItemPriorityBadge itemId={item.id} className="mb-1" />
                  <span className="os-break block">{displayField(item.product)}</span>
                  <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                    <WorkItemWarningBadge item={item} onSelectField={() => onSelectItem(item)} />
                  </div>
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
                {showPackagingColumns && (
                  <>
                    <td className={`${tdClass} hidden lg:table-cell`}>
                      <span className="os-break">
                        {displayField(item.packagingLote ?? item.loteRef)}
                      </span>
                    </td>
                    <td className={`${tdClass} hidden lg:table-cell`}>
                      <span className="os-break">{displayField(item.packagingVto)}</span>
                    </td>
                    <td className={`${tdClass} hidden lg:table-cell`}>
                      <span className="os-break">{displayField(item.oaRef)}</span>
                    </td>
                  </>
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
                  {item.reworkRequestedAt ? (
                    <p className="mb-1 font-medium text-[var(--genus-warning,#b45309)]">
                      Rehacer: {item.reworkReason || "Sin motivo informado"}
                    </p>
                  ) : null}
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
    </ExcelOrList>
    </div>
  );
}
