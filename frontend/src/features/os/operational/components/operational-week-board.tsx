"use client";

import { priorityEdge, WorkItemPriorityBadge } from "./work-item-priority-badge";
import { useWorkItemSemanasPriority } from "../hooks/use-work-item-priorities";
import { useState, type CSSProperties, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { WorkItem } from "@/types/operational/work-item";
import type { WeeklyPlanItemDto } from "@/lib/planning/weekly-plan-dto";
import {
  dayOfWeekName,
  formatOperationalLongDate,
  parseIsoDate,
  weekStartMonday,
} from "@/lib/operational/operational-calendar";
import { displayField } from "@/lib/operational/display-fields";
import { workItemCoversDate } from "@/lib/operational/work-item-date-range";
import { groupWorkItemsByDay } from "@/lib/operational/work-item-filters";
import { isWorkItemReschedulable } from "../lib/work-transfer-labels";
import { StatusChip } from "./operational-ui";
import { DeliveryDateBadge } from "./delivery-date-badge";
import { WorkItemWarningBadge } from "./work-item-warning-badge";
import { NO_CELL_EDITING, WorkItemCard, type WorkItemCardsProps } from "./work-item-cards";

/** Id del día destino codificado en el droppable — `${zone}::${day}`. */
export function weekBoardDropId(zone: string, day: string): string {
  return `${zone}::${day}`;
}

export function parseWeekBoardDropId(id: string): { zone: string; day: string } | null {
  const idx = id.indexOf("::");
  if (idx < 0) return null;
  return { zone: id.slice(0, idx), day: id.slice(idx + 2) };
}

interface OperationalWeekBoardProps {
  weekDays: string[];
  today: string;
  selectedDate: string;
  items: WorkItem[];
  onSelectDay: (iso: string) => void;
  /** operational = Mi trabajo (default). consulta = planes compartidos RO. */
  mode?: "operational" | "consulta";
  /** Required when mode=consulta — unique items (not duplicated per day). */
  consultaItems?: WeeklyPlanItemDto[];
  /** Oculta el título "Semana · dd/mm – dd/mm" propio — usado cuando el padre ya muestra un encabezado (ej. grilla de líneas simultáneas). */
  hideHeader?: boolean;
  /**
   * Tarjetas más grandes y con más datos por trabajo (Producto/Cliente/
   * Cantidad + Lote/VTO/OA/Entrega/Estado) — opt-in, solo mode="operational".
   * Default false: no cambia nada para los llamadores existentes
   * (Elaboración, consulta).
   */
  richCards?: boolean;
  /**
   * Habilita drag & drop de replanificación (solo Producción) — opt-in,
   * default false: no cambia nada para los llamadores existentes. El padre
   * debe envolver todas las instancias que comparten un drop (ej. las 3
   * líneas de Envasado) en un único DndContext y manejar onDragEnd.
   */
  draggable?: boolean;
  /**
   * Identidad de esta grilla dentro del DndContext compartido del padre —
   * para Envasado, el bucket de línea ("1"/"2"/"3"/"opcional"); para
   * Elaboración/Codificado, un id fijo (no hay línea que cambiar).
   */
  dropZoneId?: string;
  /**
   * Habilita el botón "+" de asignación directa por celda día/línea — solo
   * Producción/Dirección (mismo gate que `draggable`). Default false: no
   * cambia nada para los llamadores existentes.
   */
  canCreate?: boolean;
  /** Se dispara al clickear "+" en una celda — recibe el día ISO y el `dropZoneId` de esa grilla. */
  onCreateSlot?: (day: string, zone: string) => void;
  /** Producción: botón «Editar» en cada tarjeta → abre el detalle con la planificación editable. */
  onEditItem?: (item: WorkItem) => void;
  /**
   * Vista Semana unificada: cada trabajo se dibuja con la MISMA tarjeta que la vista Día (`WorkItemCard`, tamaño
   * compacto), agrupada por día. Es de consulta (la edición de planificación sigue en el detalle) y conserva las
   * acciones de la tarjeta: ver detalle / registrar avance, archivar y restaurar.
   */
  cards?: Pick<WorkItemCardsProps, "variant" | "getFinishedQty" | "getObservation" | "onSelectItem" | "listMode" | "onArchiveFromView" | "onRestoreToView" | "archiveBusyId" | "showPackagingColumns">;
  /**
   * «columns» (Envasado): los 5 días en columnas (3 en tablet), tarjetas compactas, contador por día y desplazamiento
   * INTERNO si un día tiene muchos trabajos (la columna no estira la página). Requiere `cards`. En celular se ve solo el
   * día `mobileDay` (el padre muestra el selector de días). Default «stack»: sin cambios para los demás llamadores.
   */
  layout?: "stack" | "columns";
  /** Día visible en celular con `layout="columns"`. */
  mobileDay?: string;
  /** Con `layout="columns"`: el padre ya muestra día y contador alineados en escritorio (no se repiten por celda). */
  dayHeadersInParent?: boolean;
  /** Producción: elegir cualquier fecha (otra semana/mes) desde la tarjeta; el padre pide confirmación antes de guardar. */
  onRequestDate?: (item: WorkItem, plannedDate: string) => void;
}

/** Botón discreto de edición; no inicia el arrastre ni selecciona el día. */
function CardEditButton({ item, onEditItem }: { item: WorkItem; onEditItem?: (item: WorkItem) => void }) {
  if (!onEditItem) return null;
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onEditItem(item);
      }}
      className="inline-flex items-center gap-1 rounded border border-[var(--os-teal)]/50 px-1.5 py-0.5 text-[0.65rem] font-semibold text-[var(--os-teal)] hover:bg-[var(--os-teal)]/10"
      aria-label={`Editar ${item.product ?? "trabajo"}`}
      data-testid="week-board-edit"
    >
      <Pencil className="size-3" aria-hidden="true" /> Editar
    </button>
  );
}

/** Envuelve una tarjeta con drag & drop — no-op visual si `disabled`. */
function DraggableCard({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    disabled,
  });
  const style: CSSProperties = transform
    ? {
        transform: CSS.Translate.toString(transform),
        zIndex: 20,
        position: "relative",
        opacity: isDragging ? 0.85 : 1,
      }
    : {};
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(disabled ? {} : { ...attributes, ...listeners })}
      className={disabled ? undefined : "cursor-grab touch-none active:cursor-grabbing"}
      data-testid="week-board-draggable-card"
    >
      {children}
    </div>
  );
}

function dtoCoversDate(item: WeeklyPlanItemDto, day: string): boolean {
  return workItemCoversDate(
    {
      plannedDate: item.plannedDate,
      plannedDateTo: item.plannedDateTo,
    },
    day
  );
}

function dayRangeLabel(item: WeeklyPlanItemDto): string {
  if (item.plannedDate === item.plannedDateTo) {
    return dayOfWeekName(item.plannedDate);
  }
  return `${dayOfWeekName(item.plannedDate)} – ${dayOfWeekName(item.plannedDateTo)}`;
}

function ConsultaCard({ item }: { item: WeeklyPlanItemDto }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded border border-[var(--os-border)]/70 bg-[var(--os-surface)]/40 p-2 text-left text-xs leading-snug text-[var(--os-text)]">
      <p className="line-clamp-2 font-medium" title={item.product}>
        {item.product}
      </p>
      <p className="mt-0.5 line-clamp-2 text-[var(--os-text-muted)]" title={item.client}>
        {item.client}
      </p>
      <p className="mt-1 text-[var(--os-text-muted)]">
        {item.quantity} {item.unit} · {item.sectorLabel}
      </p>
      <p className="text-[var(--os-text-muted)]">{dayRangeLabel(item)}</p>
      <button
        type="button"
        className="mt-1 text-[0.65rem] font-medium text-[var(--os-teal)] underline-offset-2 hover:underline"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {open ? "Ocultar detalle" : "Ver detalle"}
      </button>
      {open && (
        <dl className="mt-2 space-y-1 border-t border-[var(--os-border)]/50 pt-2 text-[0.65rem] text-[var(--os-text-muted)]">
          <div>
            <dt className="inline font-medium text-[var(--os-text)]">Responsable: </dt>
            <dd className="inline">{item.responsible || "—"}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-[var(--os-text)]">Estado: </dt>
            <dd className="inline">{item.statusLabel}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-[var(--os-text)]">Progreso: </dt>
            <dd className="inline">{item.progressLabel}</dd>
          </div>
          {item.deliveryDate && (
            <div>
              <dt className="inline font-medium text-[var(--os-text)]">Entrega: </dt>
              <dd className="inline">{item.deliveryDate}</dd>
            </div>
          )}
          {item.lote && (
            <div>
              <dt className="inline font-medium text-[var(--os-text)]">Lote: </dt>
              <dd className="inline">{item.lote}</dd>
            </div>
          )}
          {item.notes && (
            <div>
              <dt className="font-medium text-[var(--os-text)]">Observaciones</dt>
              <dd className="line-clamp-2" title={item.notes}>
                {item.notes}
              </dd>
            </div>
          )}
        </dl>
      )}
    </li>
  );
}

/** Trabajo compacto del tablero semanal: responsable/línea + prioridad de Semanas, producto y cantidad destacados. */
function CompactWorkItem({ item, onEditItem }: { item: WorkItem; onEditItem?: (item: WorkItem) => void }) {
  const semanas = useWorkItemSemanasPriority(item.id);
  return (
    <li className="pl-2 text-xs leading-snug text-[var(--os-text)]" style={priorityEdge(semanas?.priority, 3)} data-semanas-priority={semanas?.priority}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="font-medium">{displayField(item.line ?? item.ownerPerson)}</span>
        <WorkItemPriorityBadge itemId={item.id} tone="solid" />
      </div>
      <div className="font-semibold">{displayField(item.product ?? item.client)}</div>
      <div className="font-semibold tabular-nums">{displayField(item.quantity)} {item.unit ?? ""}</div>
      {onEditItem && <div className="mt-1"><CardEditButton item={item} onEditItem={onEditItem} /></div>}
    </li>
  );
}

/**
 * Tarjeta enriquecida de un trabajo — jerarquía Producto > Cliente >
 * Cantidad, luego datos secundarios compactos (Lote/VTO/OA, sin repetir la
 * fecha de producción: ya la da la columna del día). Estado como chip.
 */
function WorkItemRichCard({ item, onEditItem }: { item: WorkItem; onEditItem?: (item: WorkItem) => void }) {
  const semanas = useWorkItemSemanasPriority(item.id);
  const secondary = [
    item.packagingLote ? `Lote ${item.packagingLote}` : null,
    item.packagingVto ? `VTO ${item.packagingVto}` : null,
    item.oaRef ?? item.oeRef ?? null,
  ].filter(Boolean);

  return (
    <li className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] p-2.5 text-xs leading-snug text-[var(--os-text)] shadow-sm" style={priorityEdge(semanas?.priority)} data-semanas-priority={semanas?.priority}>
      <WorkItemPriorityBadge itemId={item.id} className="mb-1" />
      <p className="line-clamp-2 text-sm font-semibold" title={item.product ?? ""}>
        {displayField(item.product)}
      </p>
      <p className="mt-0.5 line-clamp-1 text-[var(--os-text-muted)]" title={item.client ?? ""}>
        {displayField(item.client)}
      </p>
      <p className="mt-1 font-medium tabular-nums text-[var(--os-teal)]">
        {displayField(item.quantity)} {item.unit ?? ""}
      </p>
      {secondary.length > 0 && (
        <p className="mt-1.5 truncate text-[0.7rem] text-[var(--os-text-muted)]" title={secondary.join(" · ")}>
          {secondary.join(" · ")}
        </p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <StatusChip status={item.status} />
        {item.deliveryDate ? <DeliveryDateBadge deliveryDate={item.deliveryDate} /> : null}
        <CardEditButton item={item} onEditItem={onEditItem} />
      </div>
      <div className="mt-1.5">
        <WorkItemWarningBadge item={item} />
      </div>
    </li>
  );
}

interface WeekBoardDayCellProps {
  day: string;
  dayItems: WorkItem[];
  dayConsulta: WeeklyPlanItemDto[];
  isToday: boolean;
  isSelected: boolean;
  mode: "operational" | "consulta";
  richCards: boolean;
  draggable: boolean;
  dropZoneId: string;
  canCreate: boolean;
  onSelectDay: (iso: string) => void;
  onCreateSlot?: (day: string, zone: string) => void;
  onEditItem?: (item: WorkItem) => void;
  cards?: OperationalWeekBoardProps["cards"];
}

function WeekBoardDayCell({
  day,
  dayItems,
  dayConsulta,
  isToday,
  isSelected,
  mode,
  richCards,
  draggable,
  dropZoneId,
  canCreate,
  onSelectDay,
  onCreateSlot,
  onEditItem,
  cards,
}: WeekBoardDayCellProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: weekBoardDropId(dropZoneId, day),
    disabled: !draggable,
  });
  const count = mode === "consulta" ? dayConsulta.length : dayItems.length;

  const className = `rounded border px-3 py-3 text-left transition ${
    isToday
      ? mode === "consulta"
        ? "border-[var(--os-teal)] bg-[var(--os-teal)]/10"
        : "border-emerald-600 bg-emerald-50/70"
      : isSelected
        ? "border-[var(--os-text)] bg-[var(--os-bg)]"
        : "border-[var(--os-border)] hover:border-[var(--os-text-muted)]"
  } ${draggable && isOver ? "ring-2 ring-[var(--os-teal)] ring-offset-1" : ""}`;

  const body = (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{dayOfWeekName(day)}</span>
        {isToday && (
          <span
            className={`text-[0.65rem] font-bold uppercase tracking-wide ${
              mode === "consulta" ? "text-[var(--os-teal)]" : "text-emerald-800"
            }`}
          >
            Hoy
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-[var(--os-text-muted)]">{formatOperationalLongDate(day)}</p>
      {count === 0 ? (
        <p className="text-xs text-[var(--os-text-muted)]" data-testid="week-board-empty-day">
          {draggable ? "Sin trabajos — soltá acá para mover" : "Sin trabajos"}
        </p>
      ) : mode === "consulta" ? (
        <ul className="space-y-2">
          {dayConsulta.slice(0, 6).map((item) => (
            <ConsultaCard key={item.workItemId} item={item} />
          ))}
          {dayConsulta.length > 6 && (
            <li className="text-[0.65rem] text-[var(--os-text-muted)]">+{dayConsulta.length - 6} más</li>
          )}
        </ul>
      ) : cards ? (
        <ul
          className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,15.5rem),1fr))]"
          data-testid="week-board-cards"
        >
          {dayItems.map((item) => {
            const card = (
              <WorkItemCard {...cards} item={item} cells={NO_CELL_EDITING} density="compact" items={[]} />
            );
            return (
              <li key={item.id} className="min-w-0" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                {draggable ? (
                  <DraggableCard id={item.id} disabled={!isWorkItemReschedulable(item.status)}>
                    {card}
                  </DraggableCard>
                ) : (
                  card
                )}
              </li>
            );
          })}
        </ul>
      ) : richCards ? (
        <ul className="space-y-2">
          {dayItems.slice(0, 5).map((item) =>
            draggable ? (
              <DraggableCard
                key={item.id}
                id={item.id}
                disabled={!isWorkItemReschedulable(item.status)}
              >
                <WorkItemRichCard item={item} onEditItem={onEditItem} />
              </DraggableCard>
            ) : (
              <WorkItemRichCard key={item.id} item={item} onEditItem={onEditItem} />
            )
          )}
          {dayItems.length > 5 && (
            <li className="text-[0.7rem] font-medium text-[var(--os-text-muted)]">
              +{dayItems.length - 5} más
            </li>
          )}
        </ul>
      ) : (
        <ul className="space-y-2">
          {dayItems.slice(0, 6).map((item) => {
            const compact = <CompactWorkItem key={item.id} item={item} onEditItem={onEditItem} />;
            return draggable ? (
              <DraggableCard
                key={item.id}
                id={item.id}
                disabled={!isWorkItemReschedulable(item.status)}
              >
                {compact}
              </DraggableCard>
            ) : (
              compact
            );
          })}
          {dayItems.length > 6 && (
            <li className="text-[0.65rem] text-[var(--os-text-muted)]">+{dayItems.length - 6} más</li>
          )}
        </ul>
      )}
      {canCreate && mode !== "consulta" && onCreateSlot ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCreateSlot(day, dropZoneId);
          }}
          className="mt-2 flex w-full items-center justify-center rounded border border-dashed border-[var(--os-teal)]/50 py-1 text-sm font-semibold text-[var(--os-teal)] transition hover:border-[var(--os-teal)] hover:bg-[var(--os-teal)]/10"
          aria-label={`Asignar trabajo — ${dayOfWeekName(day)}`}
          data-testid={`week-board-create-${weekBoardDropId(dropZoneId, day)}`}
        >
          +
        </button>
      ) : null}
    </>
  );

  if (!draggable && !canCreate && !cards) {
    return (
      <button type="button" onClick={() => onSelectDay(day)} className={className}>
        {body}
      </button>
    );
  }

  return (
    <div
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      onClick={() => onSelectDay(day)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelectDay(day);
        }
      }}
      className={className}
      data-testid={`week-board-daycell-${weekBoardDropId(dropZoneId, day)}`}
    >
      {body}
    </div>
  );
}

/** «LUN 28/09» — encabezado corto de columna. */
export function shortDayLabel(iso: string): string {
  const p = parseIsoDate(iso);
  return `${dayOfWeekName(iso).slice(0, 3).toUpperCase()} ${p?.day ?? ""}/${p?.month ?? ""}`;
}

/** Tarjeta compacta de la vista semanal: lo esencial de un vistazo; el detalle completo se abre al tocarla. */
function WeekJobCard({
  item,
  cards,
  onEditItem,
  onRequestDate,
}: {
  item: WorkItem;
  cards: NonNullable<OperationalWeekBoardProps["cards"]>;
  onEditItem?: (item: WorkItem) => void;
  onRequestDate?: (item: WorkItem, plannedDate: string) => void;
}) {
  const semanas = useWorkItemSemanasPriority(item.id);
  const finished = item.finishedQty ?? cards.getFinishedQty(item.id);
  const archived = cards.listMode === "archived";
  const archiveAction = archived ? cards.onRestoreToView : cards.onArchiveFromView;
  const open = () => cards.onSelectItem?.(item);
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        open();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          open();
        }
      }}
      className="cursor-pointer rounded-md border border-white/10 bg-[#10304a] px-2 py-1 text-left shadow-[0_4px_12px_-10px_rgba(0,0,0,0.7)] transition hover:border-[var(--os-teal)]/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--os-teal)]"
      style={priorityEdge(semanas?.priority, 4)}
      data-testid="week-job-card"
      data-item-id={item.id}
      data-semanas-priority={semanas?.priority ?? "NONE"}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="truncate text-[13px] font-semibold leading-tight text-white" title={item.product ?? ""}>
          {displayField(item.product)}
        </p>
        {semanas?.priority ? <WorkItemPriorityBadge itemId={item.id} tone="solid" className="shrink-0" /> : null}
      </div>
      <p className="truncate text-[11px] leading-tight text-[#9fc0d4]" title={item.client ?? ""}>
        {displayField(item.client)}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <span className="text-[12px] font-semibold tabular-nums text-[var(--os-teal)]" data-testid="week-job-qty">
          {displayField(item.quantity)} {item.unit ?? ""}
        </span>
        {finished && String(finished).trim() && String(finished).trim() !== "0" ? (
          <span className="text-[11px] tabular-nums text-[#cfe0ea]" title="Cantidad realizada">· hecho {finished}</span>
        ) : null}
        <span className="ml-auto origin-right scale-90">
          <StatusChip status={item.status} />
        </span>
      </div>
      {(onEditItem || archiveAction || onRequestDate) && (
        <div className="flex flex-wrap items-center justify-end gap-1">
          {onRequestDate ? (
            <label
              className="mr-auto inline-flex items-center gap-1 text-[0.6rem] font-semibold text-[#9fc0d4]"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              title="Cambiar la fecha (cualquier día, otra semana o mes)"
            >
              Fecha
              <input
                type="date"
                value={item.plannedDate ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v >= "2000-01-01" && v !== item.plannedDate) onRequestDate(item, v);
                }}
                className="rounded border border-white/15 bg-transparent px-1 text-[0.65rem] text-white [color-scheme:dark]"
                aria-label={`Fecha de ${item.product ?? "trabajo"}`}
                data-testid="week-job-date"
              />
            </label>
          ) : null}
          <CardEditButton item={item} onEditItem={onEditItem} />
          {archiveAction ? (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                void archiveAction(item);
              }}
              disabled={cards.archiveBusyId === item.id}
              className="rounded px-1 text-[0.6rem] font-semibold leading-4 text-[#9fc0d4] hover:bg-white/10 hover:text-white disabled:opacity-50"
              data-testid={archived ? "week-job-restore" : "week-job-archive"}
            >
              {archived ? "Restaurar" : "Archivar"}
            </button>
          ) : null}
        </div>
      )}
    </article>
  );
}

/** Columna de un día (layout «columns»): encabezado de una línea con contador, lista con desplazamiento interno. */
function WeekColumnCell({
  day,
  dayItems,
  isToday,
  hiddenOnMobile,
  draggable,
  dropZoneId,
  canCreate,
  onSelectDay,
  onCreateSlot,
  onEditItem,
  cards,
  compactHeader = false,
  onRequestDate,
}: {
  day: string;
  dayItems: WorkItem[];
  isToday: boolean;
  hiddenOnMobile: boolean;
  /** Escritorio: oculta el encabezado de la celda (el padre muestra la fila de totales por día alineada). */
  compactHeader?: boolean;
  onRequestDate?: (item: WorkItem, plannedDate: string) => void;
  draggable: boolean;
  dropZoneId: string;
  canCreate: boolean;
  onSelectDay: (iso: string) => void;
  onCreateSlot?: (day: string, zone: string) => void;
  onEditItem?: (item: WorkItem) => void;
  cards: NonNullable<OperationalWeekBoardProps["cards"]>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: weekBoardDropId(dropZoneId, day), disabled: !draggable });
  const count = dayItems.length;
  return (
    <div
      ref={setNodeRef}
      className={`${hiddenOnMobile ? "hidden md:flex" : "flex"} min-w-0 flex-col rounded-lg border p-1.5 transition ${
        isToday ? "border-[var(--os-teal)]/70 bg-[var(--os-teal)]/[0.06]" : "border-[var(--os-border)] bg-[var(--os-bg)]/40"
      } ${draggable && isOver ? "ring-2 ring-[var(--os-teal)] ring-offset-1" : ""}`}
      data-testid={`week-board-daycell-${weekBoardDropId(dropZoneId, day)}`}
      data-day={day}
      data-count={count}
    >
      <button
        type="button"
        onClick={() => onSelectDay(day)}
        className={`mb-1 flex w-full items-center justify-between gap-1 rounded px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--os-text-muted)] hover:text-[var(--os-text)] ${compactHeader ? "lg:hidden" : ""}`}
        title={`Ver ${dayOfWeekName(day)} en vista Día`}
      >
        <span className={isToday ? "text-[var(--os-teal)]" : undefined}>
          {shortDayLabel(day)}
          {isToday ? " · hoy" : ""}
        </span>
        <span
          className={`rounded-full px-1.5 text-[10px] tabular-nums ${count ? "bg-[var(--os-teal)]/20 text-[var(--os-teal)]" : "bg-white/5"}`}
          data-testid="week-col-count"
          aria-label={`${count} trabajo${count === 1 ? "" : "s"}`}
        >
          {count}
        </span>
      </button>
      {count === 0 ? (
        <p className="px-1 py-0.5 text-[11px] text-[var(--os-text-muted)]" data-testid="week-board-empty-day">
          {draggable ? "Sin trabajos — soltá acá" : "Sin trabajos"}
        </p>
      ) : (
        <ul className="space-y-1.5 overflow-y-auto pr-0.5" style={{ maxHeight: "min(22rem, 50vh)" }} data-testid="week-board-cards">
          {dayItems.map((item) => {
            const card = <WeekJobCard item={item} cards={cards} onEditItem={onEditItem} onRequestDate={draggable && isWorkItemReschedulable(item.status) ? onRequestDate : undefined} />;
            return (
              <li key={item.id} className="min-w-0">
                {draggable ? (
                  <DraggableCard id={item.id} disabled={!isWorkItemReschedulable(item.status)}>
                    {card}
                  </DraggableCard>
                ) : (
                  card
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canCreate && onCreateSlot ? (
        <button
          type="button"
          onClick={() => onCreateSlot(day, dropZoneId)}
          className="mt-1 flex w-full items-center justify-center rounded border border-dashed border-[var(--os-teal)]/40 py-0.5 text-xs font-semibold text-[var(--os-teal)] transition hover:border-[var(--os-teal)] hover:bg-[var(--os-teal)]/10"
          aria-label={`Asignar trabajo — ${dayOfWeekName(day)}`}
          data-testid={`week-board-create-${weekBoardDropId(dropZoneId, day)}`}
        >
          +
        </button>
      ) : null}
    </div>
  );
}

/** Vista Semana operativa — L–V con resalte de Hoy. */
export function OperationalWeekBoard({
  weekDays,
  today,
  selectedDate,
  items,
  onSelectDay,
  mode = "operational",
  consultaItems = [],
  hideHeader = false,
  richCards = false,
  draggable = false,
  dropZoneId = "default",
  canCreate = false,
  onCreateSlot,
  onEditItem,
  cards,
  layout = "stack",
  mobileDay,
  dayHeadersInParent = false,
  onRequestDate,
}: OperationalWeekBoardProps) {
  const weekStart = weekDays[0] ?? weekStartMonday(today);
  const end = weekDays[weekDays.length - 1];
  const startParts = parseIsoDate(weekStart);
  const endParts = parseIsoDate(end ?? weekStart);

  const byDate = new Map<string, WorkItem[]>();
  const consultaByDate = new Map<string, WeeklyPlanItemDto[]>();
  for (const day of weekDays) {
    byDate.set(day, []);
    consultaByDate.set(day, []);
  }

  if (mode === "consulta") {
    for (const item of consultaItems) {
      for (const day of weekDays) {
        if (!dtoCoversDate(item, day)) continue;
        consultaByDate.get(day)!.push(item);
      }
    }
  } else {
    // Misma regla que la vista Día (Día a día): ver groupWorkItemsByDay.
    for (const [day, dayItems] of groupWorkItemsByDay(items, weekDays)) byDate.set(day, dayItems);
  }

  if (layout === "columns" && cards && mode === "operational") {
    return (
      <div className="grid items-start gap-2 md:grid-cols-3 lg:grid-cols-5" data-testid="week-board-columns" data-zone={dropZoneId}>
        {weekDays.map((day) => (
          <WeekColumnCell
            key={day}
            day={day}
            dayItems={byDate.get(day) ?? []}
            isToday={day === today}
            hiddenOnMobile={day !== (mobileDay ?? weekDays[0])}
            draggable={draggable}
            dropZoneId={dropZoneId}
            canCreate={canCreate}
            onSelectDay={onSelectDay}
            onCreateSlot={onCreateSlot}
            onEditItem={onEditItem}
            cards={cards}
            compactHeader={Boolean(dayHeadersInParent)}
            onRequestDate={onRequestDate}
          />
        ))}
      </div>
    );
  }

  return (
    <section className="space-y-4 overflow-x-hidden">
      {!hideHeader && (
        <header>
          <h3 className="text-lg font-semibold tracking-tight text-[var(--os-text)]">
            Semana · {startParts?.day}/{startParts?.month} – {endParts?.day}/{endParts?.month}
          </h3>
          <p className="text-sm text-[var(--os-text-muted)]">
            {mode === "consulta"
              ? "Consulta compartida. Un mismo trabajo puede verse varios días sin duplicar el registro."
              : "Seleccioná un día para trabajarlo en vista Día."}
          </p>
        </header>
      )}

      <div className={`${mode === "consulta" ? "hidden md:grid" : "grid"} gap-3 ${cards && mode === "operational" ? "" : "md:grid-cols-5"}`}>
        {weekDays.map((day) => (
          <WeekBoardDayCell
            key={day}
            day={day}
            dayItems={byDate.get(day) ?? []}
            dayConsulta={consultaByDate.get(day) ?? []}
            isToday={day === today}
            isSelected={day === selectedDate}
            mode={mode}
            richCards={richCards}
            draggable={draggable}
            dropZoneId={dropZoneId}
            canCreate={canCreate}
            onSelectDay={onSelectDay}
            onCreateSlot={onCreateSlot}
            onEditItem={onEditItem}
            cards={cards}
          />
        ))}
      </div>

      {/* Mobile: day cards with expandable secondary info */}
      {mode === "consulta" && (
        <div className="space-y-3 md:hidden">
          {weekDays.map((day) => {
            const dayConsulta = consultaByDate.get(day) ?? [];
            return (
              <section
                key={`m-${day}`}
                className="rounded border border-[var(--os-border)] p-3"
              >
                <h4 className="text-sm font-semibold">
                  {dayOfWeekName(day)} · {formatOperationalLongDate(day)}
                </h4>
                {dayConsulta.length === 0 ? (
                  <p className="mt-2 text-xs text-[var(--os-text-muted)]">Sin trabajos</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {dayConsulta.map((item) => (
                      <ConsultaCard key={`${day}-${item.workItemId}`} item={item} />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
