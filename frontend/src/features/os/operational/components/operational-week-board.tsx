"use client";

import { useState } from "react";
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
        {weekDays.map((day) => {
          const dayItems = byDate.get(day) ?? [];
          const dayConsulta = consultaByDate.get(day) ?? [];
          const isToday = day === today;
          const isSelected = day === selectedDate;
          const count = mode === "consulta" ? dayConsulta.length : dayItems.length;
          return (
            <button
              key={day}
              type="button"
              onClick={() => onSelectDay(day)}
              className={`rounded border px-3 py-3 text-left transition ${
                isToday
                  ? mode === "consulta"
                    ? "border-[var(--os-teal)] bg-[var(--os-teal)]/10"
                    : "border-emerald-600 bg-emerald-50/70"
                  : isSelected
                    ? "border-[var(--os-text)] bg-[var(--os-bg)]"
                    : "border-[var(--os-border)] hover:border-[var(--os-text-muted)]"
              }`}
            >
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
              <p className="mb-3 text-xs text-[var(--os-text-muted)]">
                {formatOperationalLongDate(day)}
              </p>
              {count === 0 ? (
                <p className="text-xs text-[var(--os-text-muted)]">Sin trabajos</p>
              ) : mode === "consulta" ? (
                <ul className="space-y-2">
                  {dayConsulta.slice(0, 6).map((item) => (
                    <ConsultaCard key={item.workItemId} item={item} />
                  ))}
                  {dayConsulta.length > 6 && (
                    <li className="text-[0.65rem] text-[var(--os-text-muted)]">
                      +{dayConsulta.length - 6} más
                    </li>
                  )}
                </ul>
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
