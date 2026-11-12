"use client";

import { useMemo, useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { X } from "lucide-react";
import { useDesignPreviewPortalContainer } from "@/lib/utils/use-design-preview-portal-container";
import { MeBadge } from "./me-badge";
import { holidayScopeLabel, plantHolidaysBetween, type PlantHoliday } from "@/lib/holidays/holiday-calendar";
import { buildMonthGrid, groupItemsByMonthDay, undatedItems, type MonthItem } from "@/lib/operational/month-grid";

const DOW = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"] as const;
const MAX_CHIPS = 4;

interface Props<T extends MonthItem> {
  monthStart: string;
  today: string;
  /** Trabajos del sector que solapan la grilla del mes (los MISMOS que ve la vista Semanal). */
  items: T[];
  /** Todos los trabajos activos del sector: de ahí salen los «Sin fecha asignada». */
  allItems: T[];
  /** Puede asignar/reprogramar (permisos del sector). Sin esto es de solo lectura. */
  canEdit: boolean;
  onSelectItem: (item: T) => void;
  /** Botón «+» de un día: abre el MISMO formulario de asignación de la vista Semanal. */
  onCreateSlot?: (day: string) => void;
  /** Reprogramar (arrastrar o elegir fecha): pasa por el mismo CONFIRMAR / CANCELAR que la vista Semanal. */
  onRequestDate?: (item: T, day: string) => void;
  /** Ir a la vista Día de esa fecha. */
  onSelectDay?: (day: string) => void;
  /** false = oculta «Sin fecha asignada» (planes de solo lectura que no traen trabajos sin fecha). */
  showUndated?: boolean;
  /**
   * Tarjeta flotante informativa: al tocar un trabajo se abre junto a él (no navega ni abre formularios). Un solo trabajo abierto a la
   * vez; se cierra con la X, tocando afuera o con Esc. Si se pasa, reemplaza al `onSelectItem` en los trabajos del calendario.
   */
  renderDetail?: (item: T) => ReactNode;
}

function chipTitle(it: MonthItem): string {
  const me = it.me ? ` · ME: ${it.me.status === "OK" ? "✅" : it.me.status === "NO_OK" ? "❌" : "Sin info"}${it.me.observation ? ` (${it.me.observation})` : ""}` : "";
  return `${chipLabel(it)}${me}`;
}

function chipLabel(it: MonthItem): string {
  const qty = it.quantity ? ` · ${it.quantity}${it.unit ? ` ${it.unit}` : ""}` : "";
  return `${it.product ?? "Trabajo"}${it.client ? ` — ${it.client}` : ""}${qty}`;
}

/**
 * Vista MENSUAL de la planificación: calendario completo del mes con los trabajos de cada día, «+» para asignar, reprogramación y
 * la sección «Sin fecha asignada». Es una perspectiva más amplia de la MISMA planificación (no duplica trabajos).
 */
export function OperationalMonthBoard<T extends MonthItem>({ monthStart, today, items, allItems, canEdit, onSelectItem, onCreateSlot, onRequestDate, onSelectDay, showUndated = true, renderDetail }: Props<T>) {
  // La tarjeta se monta DENTRO del tema (.design-preview-root), no en document.body: ahí no existen las variables --os-*.
  const portalContainer = useDesignPreviewPortalContainer();
  const grid = useMemo(() => buildMonthGrid(monthStart), [monthStart]);
  const byDay = useMemo(() => groupItemsByMonthDay(items, grid), [items, grid]);
  // Feriados de la planta (PBA): informativos, NO bloquean la planificación. Calendario central: mismo resultado en todos los sectores.
  const holidays = useMemo<Map<string, PlantHoliday>>(() => plantHolidaysBetween(grid[0]![0]!.date, grid[grid.length - 1]![6]!.date), [grid]);
  const [openHoliday, setOpenHoliday] = useState<string | null>(null);
  const sinFecha = useMemo(() => undatedItems(allItems), [allItems]);
  const [expanded, setExpanded] = useState<string | null>(null);
  /** Chip con la tarjeta abierta: `<día>|<id>` (un trabajo de varios días se ancla al día que se tocó). */
  const [openChip, setOpenChip] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const byId = useMemo(() => new Map<string, T>([...items, ...allItems].map((i) => [i.id, i])), [items, allItems]);

  return (
    <div className="space-y-4" data-testid="month-board" data-month={monthStart}>
      {canEdit ? <p className="text-xs text-[var(--os-text-muted)]">Arrastrá un trabajo a otro día para reprogramarlo, o abrilo para editarlo. «+» asigna un trabajo nuevo en ese día.</p> : null}
      <div className="overflow-x-auto">
        <div className="min-w-[44rem]">
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-[var(--os-text-muted)]">
            {DOW.map((d) => <div key={d}>{d}</div>)}
          </div>
          <div className="mt-1 space-y-1">
            {grid.map((week) => (
              <div key={week[0]!.date} className="grid grid-cols-7 gap-1">
                {week.map((cell) => {
                  const list = byDay.get(cell.date) ?? [];
                  const open = expanded === cell.date;
                  const shown = open ? list : list.slice(0, MAX_CHIPS);
                  const holiday = holidays.get(cell.date) ?? null;
                  const holidayOpen = holiday !== null && openHoliday === cell.date;
                  return (
                    <div
                      key={cell.date}
                      className={`min-h-[5.5rem] rounded border p-1 ${holiday ? "bg-[#7f1d1d]/25" : cell.inMonth ? "bg-[var(--os-surface)]" : "bg-[var(--os-bg)]"} ${cell.inMonth ? "" : "opacity-60"} ${cell.date === today ? "border-[var(--os-teal)]" : holiday ? "border-[#b91c1c]/50" : "border-[var(--os-border)]"}`}
                      data-testid="month-day"
                      data-day={cell.date}
                      data-holiday={holiday ? holiday.scope : undefined}
                      onClick={holiday ? (e) => { if (e.target === e.currentTarget) setOpenHoliday(holidayOpen ? null : cell.date); } : undefined}
                      data-count={list.length}
                      onDragOver={canEdit && onRequestDate ? (e) => e.preventDefault() : undefined}
                      onDrop={
                        canEdit && onRequestDate
                          ? (e) => {
                              e.preventDefault();
                              const it = byId.get(e.dataTransfer.getData("text/plain") || dragId || "");
                              setDragId(null);
                              if (it && it.plannedDate !== cell.date) onRequestDate(it, cell.date);
                            }
                          : undefined
                      }
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <button type="button" className={`text-xs font-semibold ${cell.date === today ? "text-[var(--os-teal)]" : ""}`} onClick={() => onSelectDay?.(cell.date)} title="Ver este día">
                          {Number(cell.date.slice(8))}
                        </button>
                        {canEdit && onCreateSlot ? (
                          <button type="button" className="rounded px-1 text-sm leading-none text-[var(--os-teal)] hover:bg-[var(--os-teal)]/15" aria-label={`Asignar trabajo el ${cell.date}`} onClick={() => onCreateSlot(cell.date)} data-testid="month-add">+</button>
                        ) : null}
                      </div>
                      {holiday ? (
                        <div className="mb-1" data-testid="month-holiday">
                          <button
                            type="button"
                            className="rounded bg-[#991b1b]/45 px-1 py-px text-[10px] font-bold uppercase tracking-wide text-red-100 hover:bg-[#991b1b]/65"
                            aria-expanded={holidayOpen}
                            aria-label={`Feriado: ${holiday.name}`}
                            title={holiday.name}
                            onClick={() => setOpenHoliday(holidayOpen ? null : cell.date)}
                            data-testid="month-holiday-label"
                          >
                            Feriado
                          </button>
                          {holidayOpen ? (
                            <p className="mt-0.5 rounded bg-black/25 p-1 text-[11px] leading-snug text-red-50" data-testid="month-holiday-detail">
                              <strong>{holiday.name}</strong>
                              <br />
                              {holidayScopeLabel(holiday.scope)} · {holiday.jurisdiction}
                              <br />
                              <span className="text-[10px] opacity-80">{holiday.source}</span>
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      <ul className="space-y-0.5">
                        {shown.map((it) => (
                          <li key={`${cell.date}-${it.id}`}>
                            {renderDetail ? (
                              <Popover.Root open={openChip === `${cell.date}|${it.id}`} onOpenChange={(o) => setOpenChip(o ? `${cell.date}|${it.id}` : null)}>
                                <Popover.Trigger asChild>
                                  <button
                                    type="button"
                                    title={chipTitle(it)}
                                    className="block w-full rounded bg-[var(--os-teal)]/15 px-1 py-0.5 text-left text-[11px] hover:bg-[var(--os-teal)]/30"
                                    data-testid="month-chip"
                                    data-id={it.id}
                                  >
                                    <span className="block truncate">{chipLabel(it)}</span>
                                    <MeBadge me={it.me} />
                                  </button>
                                </Popover.Trigger>
                                <Popover.Portal container={portalContainer}>
                                  <Popover.Content
                                    side="bottom"
                                    align="start"
                                    sideOffset={10}
                                    collisionPadding={12}
                                    avoidCollisions
                                    sticky="always"
                                    className="os-floating-card"
                                    data-testid="month-job-card"
                                    aria-label="Detalle del trabajo"
                                  >
                                    {renderDetail(it)}
                                    <Popover.Close className="absolute right-2.5 top-2.5 rounded-md p-1.5 text-[var(--os-text-muted)] hover:bg-white/10 hover:text-[var(--os-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--os-teal)]" aria-label="Cerrar" data-testid="month-job-card-close">
                                      <X className="size-4" aria-hidden="true" />
                                    </Popover.Close>
                                  </Popover.Content>
                                </Popover.Portal>
                              </Popover.Root>
                            ) : (
                            <button
                              type="button"
                              draggable={canEdit && Boolean(onRequestDate)}
                              onDragStart={(e) => {
                                e.dataTransfer.setData("text/plain", it.id);
                                setDragId(it.id);
                              }}
                              onClick={() => onSelectItem(it)}
                              title={chipTitle(it)}
                              className="block w-full rounded bg-[var(--os-teal)]/15 px-1 py-0.5 text-left text-[11px] hover:bg-[var(--os-teal)]/30"
                              data-testid="month-chip"
                              data-id={it.id}
                            >
                              <span className="block truncate">{chipLabel(it)}</span>
                              <MeBadge me={it.me} />
                            </button>
                            )}
                          </li>
                        ))}
                      </ul>
                      {list.length > MAX_CHIPS ? (
                        <button type="button" className="mt-0.5 text-[11px] text-[var(--os-text-muted)] underline" onClick={() => setExpanded(open ? null : cell.date)}>
                          {open ? "Ver menos" : `+${list.length - MAX_CHIPS} más`}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {showUndated ? (
      <section className="rounded border border-[var(--os-border)] bg-[var(--os-surface)] p-3" data-testid="month-sin-fecha">
        <h4 className="mb-2 text-sm font-semibold">Sin fecha asignada <span className="font-normal text-[var(--os-text-muted)]">({sinFecha.length})</span></h4>
        {sinFecha.length === 0 ? (
          <p className="text-xs text-[var(--os-text-muted)]">Todos los trabajos tienen fecha.</p>
        ) : (
          <ul className="space-y-1">
            {sinFecha.map((it) => (
              <li key={it.id} className="flex flex-wrap items-center gap-2" data-testid="month-sin-fecha-item">
                <button
                  type="button"
                  draggable={canEdit && Boolean(onRequestDate)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", it.id);
                    setDragId(it.id);
                  }}
                  onClick={() => onSelectItem(it)}
                  className="min-w-0 flex-1 truncate rounded bg-[var(--os-bg)] px-2 py-1 text-left text-sm hover:bg-[var(--os-teal)]/15"
                  title={chipLabel(it)}
                >
                  {chipLabel(it)}
                </button>
                {canEdit && onRequestDate ? (
                  <input
                    type="date"
                    aria-label={`Programar ${it.product ?? "trabajo"}`}
                    className="rounded border px-2 py-1 text-xs"
                    onChange={(e) => e.target.value && onRequestDate(it, e.target.value)}
                    data-testid="month-sin-fecha-date"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      ) : null}
    </div>
  );
}
