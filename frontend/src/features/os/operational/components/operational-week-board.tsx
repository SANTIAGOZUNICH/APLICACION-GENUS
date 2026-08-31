"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
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
import { isWorkItemReschedulable } from "../lib/work-transfer-labels";
import { StatusChip } from "./operational-ui";
import { DeliveryDateBadge } from "./delivery-date-badge";

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

/**
 * Tarjeta enriquecida de un trabajo — jerarquía Producto > Cliente >
 * Cantidad, luego datos secundarios compactos (Lote/VTO/OA, sin repetir la
 * fecha de producción: ya la da la columna del día). Estado como chip.
 */
function WorkItemRichCard({ item }: { item: WorkItem }) {
  const secondary = [
    item.packagingLote ? `Lote ${item.packagingLote}` : null,
    item.packagingVto ? `VTO ${item.packagingVto}` : null,
    item.oaRef ?? item.oeRef ?? null,
  ].filter(Boolean);

  return (
    <li className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] p-2.5 text-xs leading-snug text-[var(--os-text)] shadow-sm">
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
      ) : richCards ? (
        <ul className="space-y-2">
          {dayItems.slice(0, 5).map((item) =>
            draggable ? (
              <DraggableCard
                key={item.id}
                id={item.id}
                disabled={!isWorkItemReschedulable(item.status)}
              >
                <WorkItemRichCard item={item} />
              </DraggableCard>
            ) : (
              <WorkItemRichCard key={item.id} item={item} />
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
            const compact = (
              <li key={item.id} className="text-xs leading-snug text-[var(--os-text)]">
                <span className="font-medium">{displayField(item.line ?? item.ownerPerson)}</span>
                <br />
                {displayField(item.product ?? item.client)}
                <br />
                <span className="text-[var(--os-text-muted)]">{displayField(item.quantity)}</span>
              </li>
            );
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

  if (!draggable && !canCreate) {
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
    for (const item of items) {
      for (const day of weekDays) {
        if (!workItemCoversDate(item, day)) continue;
        byDate.get(day)!.push(item);
      }
    }
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

      <div className={`${mode === "consulta" ? "hidden md:grid" : "grid"} gap-3 md:grid-cols-5`}>
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
