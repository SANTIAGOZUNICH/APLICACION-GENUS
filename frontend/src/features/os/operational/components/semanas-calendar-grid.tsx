"use client";

/**
 * Calendario de SEMANAS 2026 con celdas combinadas reales (colSpan/rowSpan), bloques de semana apilados,
 * colores/anchos/filas plegadas de la Sheet, selección de rangos, copiar/pegar y edición por celda.
 *
 * Por qué no GenusGrid acá: react-datasheet-grid no admite celdas combinadas, y una tabla plana pierde la
 * organización visual del calendario. GenusGrid se sigue usando para ENTREGAS, C/DIA y para «Ver como lista».
 * Se reutilizan las MISMAS reglas: protección por celda (viene del servidor), validación sin fórmulas,
 * vista previa en pegados masivos, motivo obligatorio en fechas históricas, rollback + reintento y
 * relectura de la Sheet tras cada guardado (nunca queda un valor optimista).
 *
 * Rendimiento: cada semana monta su tabla solo cuando está cerca del viewport (IntersectionObserver);
 * fuera de pantalla queda un marcador con la altura medida. Las semanas plegadas en la Sheet no se montan.
 */
import { memo, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { Lock } from "lucide-react";
import type { CalendarWeek } from "@/lib/semanas-sheet/calendar-model";
import { anchorInRect, anchorOf, type Pos, type Rect, type WeekLayout } from "@/lib/semanas-sheet/calendar-grid-model";
import { EngineBar, EngineNotice, EnginePreview, useCalendarEngine, type CalendarCommitChange, type CalendarCommitResult, type Overlay } from "./semanas-calendar-engine";

export type { CalendarCommitChange, CalendarCommitResult };


export interface SemanasCalendarGridProps {
  weeks: CalendarWeek[];
  /** Ancho (px) de Lun..Vie en la Sheet original. */
  dayWidths: number[];
  canEdit: boolean;
  /** Fechas anteriores a esta exigen motivo. */
  reasonRequiredBefore: string;
  historicNote?: string;
  onCommit: (changes: CalendarCommitChange[]) => Promise<CalendarCommitResult>;
  /** Semana a mostrar al abrir (la actual). */
  focusWeekId?: string | null;
  testId?: string;
  maxHeight?: number | string;
}

const ROW_PX = 22;
const LABEL_PX = 30;
const GUTTER_PX = 44;


function textOn(bg: string | undefined): string | undefined {
  if (!bg || bg.length < 7) return undefined;
  const n = Number.parseInt(bg.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.55 ? "#111827" : "#ffffff";
}

function useNearViewport(forced: boolean, index: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Sin IntersectionObserver (tests/SSR): se montan solo las primeras semanas.
  const supported = typeof IntersectionObserver !== "undefined";
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !supported) return;
    const io = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)), { rootMargin: "900px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [supported]);
  return { ref, visible: forced || (supported ? near : index < 4) };
}

interface WeekBlockProps {
  index: number;
  layout: WeekLayout;
  widths: number[];
  rect: Rect | null;
  active: Pos | null;
  editing: { pos: Pos; initial: string } | null;
  overlay: Overlay;
  readOnly: boolean;
  onCellDown: (weekId: string, pos: Pos, shift: boolean) => void;
  onCellEnter: (weekId: string, pos: Pos) => void;
  onEditEnd: (commit: boolean, value: string, move: "down" | "right" | null) => void;
  onEditStart: (weekId: string, pos: Pos) => void;
  forced: boolean;
}

const WeekBlock = memo(function WeekBlock({ index, layout, widths, rect, active, editing, overlay, readOnly, onCellDown, onCellEnter, onEditEnd, onEditStart, forced }: WeekBlockProps) {
  const { week } = layout;
  const { ref, visible } = useNearViewport(forced, index);
  const [measured, setMeasured] = useState<number | null>(null);
  const estimate = LABEL_PX + week.rows.reduce((n, r) => n + (r.height ?? ROW_PX), 0);
  // Altura real del bloque montado: el marcador la conserva al salir de pantalla (el scroll no salta).
  useEffect(() => {
    const el = ref.current;
    if (!visible || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.height > 0) setMeasured(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible, ref]);
  const total = GUTTER_PX + widths.reduce((a, b) => a + b, 0);

  return (
    <div ref={ref} id={`semanas-week-${week.id}`} data-testid={`semanas-week-${week.id}`} data-week-visible={visible ? "1" : "0"} style={visible ? undefined : { height: measured ?? estimate }} className="border-b-4 border-[var(--os-border)]">
      <div className="sticky left-0 flex items-center gap-2 bg-[var(--os-surface)] px-2 text-xs font-semibold text-[var(--os-text-muted)]" style={{ height: LABEL_PX, width: "min(100%, 100vw)" }}>
        Semana {week.label}
        <span className="font-normal">· filas {week.headerRow}–{week.lastRow}</span>
      </div>
      {visible && (
        <table className="border-collapse text-[13px] leading-tight" style={{ width: total, tableLayout: "fixed" }} data-testid="semanas-cal-table">
          <colgroup>
            <col style={{ width: GUTTER_PX }} />
            {widths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <tbody>
            {week.rows.map((row, ri) => (
              <tr key={row.rowNumber} style={{ height: row.height ?? ROW_PX }}>
                <th scope="row" className="sticky left-0 z-[1] select-none border border-[var(--os-border)] bg-[var(--os-surface)] px-1 text-right text-[10px] font-normal text-[var(--os-text-muted)]">
                  {row.rowNumber}
                </th>
                {row.cells.map((cell, d) => {
                  if (cell.covered) return null;
                  const pos = { ri, d };
                  const ov = overlay[cell.a1];
                  const value = ov ? ov.value : cell.value;
                  const selected = rect ? anchorInRect(layout, pos, rect) : false;
                  const isActive = active ? anchorOf(layout, active).ri === ri && anchorOf(layout, active).d === d : false;
                  const isEditing = editing ? anchorOf(layout, editing.pos).ri === ri && anchorOf(layout, editing.pos).d === d : false;
                  const structural = row.role === "structural";
                  const bg = cell.format?.bg;
                  const style: CSSProperties = {
                    background: bg ?? (structural ? "var(--os-teal-soft)" : undefined),
                    color: cell.format?.fg ?? textOn(bg),
                    fontWeight: cell.format?.bold || structural ? 600 : undefined,
                    textAlign: structural || cell.span > 1 ? "center" : undefined,
                  };
                  return (
                    <td
                      key={cell.a1}
                      colSpan={cell.span}
                      rowSpan={cell.rowSpan}
                      data-a1={cell.a1}
                      data-r={ri}
                      data-d={d}
                      data-span={cell.span}
                      data-rowspan={cell.rowSpan}
                      data-protected={cell.protection ? "1" : undefined}
                      data-status={ov?.status}
                      aria-selected={selected}
                      title={cell.protection ?? undefined}
                      style={style}
                      className={[
                        "relative overflow-hidden border border-[color-mix(in_srgb,var(--os-border)_80%,transparent)] px-1.5 align-top whitespace-pre-wrap break-words",
                        selected ? "outline outline-1 -outline-offset-1 outline-[var(--os-teal)] [box-shadow:inset_0_0_0_9999px_rgba(20,184,166,0.16)]" : "",
                        isActive ? "outline outline-2 -outline-offset-2 outline-[var(--os-teal)]" : "",
                        cell.protection && !structural && !readOnly ? "cursor-not-allowed" : "cursor-cell",
                        ov?.status === "saving" ? "opacity-60" : "",
                        ov?.status === "error" ? "outline outline-2 -outline-offset-2 outline-red-500" : "",
                      ].join(" ")}
                      onMouseDown={(e: MouseEvent) => {
                        if ((e.target as HTMLElement).tagName === "INPUT") return;
                        onCellDown(week.id, pos, e.shiftKey);
                      }}
                      onMouseEnter={() => onCellEnter(week.id, pos)}
                      onDoubleClick={() => onEditStart(week.id, pos)}
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          data-testid="semanas-cal-input"
                          defaultValue={editing!.initial}
                          className="absolute inset-0 h-full w-full border-0 bg-[var(--os-surface)] px-1.5 text-[var(--os-text)] outline outline-2 -outline-offset-2 outline-[var(--os-teal)]"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); onEditEnd(true, e.currentTarget.value, "down"); }
                            else if (e.key === "Tab") { e.preventDefault(); onEditEnd(true, e.currentTarget.value, "right"); }
                            else if (e.key === "Escape") { e.preventDefault(); onEditEnd(false, "", null); }
                            e.stopPropagation();
                          }}
                          onBlur={(e) => onEditEnd(true, e.currentTarget.value, null)}
                        />
                      ) : (
                        <>
                          {value}
                          {cell.protection && !structural && selected && <Lock className="absolute right-0.5 top-0.5 size-3 opacity-60" aria-hidden="true" />}
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
});

export function SemanasCalendarGrid({ weeks, dayWidths, canEdit, reasonRequiredBefore, historicNote, onCommit, focusWeekId, testId = "semanas-calendar", maxHeight = "72vh" }: SemanasCalendarGridProps) {
  const e = useCalendarEngine({ weeks, canEdit, reasonRequiredBefore, onCommit, focusWeekId });
  const { layouts, sel, selRect, editing, overlay, boxRef } = e;
  const widths = dayWidths.length === 5 ? dayWidths : [288, 288, 288, 288, 288];

  return (
    <div className="space-y-2" data-testid={testId}>
      <EngineBar e={e} />
      <EngineNotice e={e} />
      <div
        ref={boxRef}
        role="grid"
        aria-label="Calendario semanal"
        aria-rowcount={weeks.length}
        tabIndex={0}
        className="relative overflow-auto rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-teal)]"
        style={{ maxHeight, overscrollBehavior: "contain" }}
        data-testid="semanas-cal-scroll"
        onKeyDown={e.onKeyDown}
        onCopy={e.onCopy}
        onPaste={e.onPaste}
      >
        {weeks.map((w, i) => {
          const layout = layouts.get(w.id)!;
          const mine = sel?.weekId === w.id;
          return (
            <WeekBlock
              key={w.id}
              index={i}
              layout={layout}
              widths={widths}
              rect={mine ? selRect : null}
              active={mine ? sel!.anchor : null}
              editing={editing?.weekId === w.id ? { pos: editing.pos, initial: editing.initial } : null}
              overlay={overlay}
              readOnly={!canEdit}
              forced={mine || w.id === focusWeekId}
              onCellDown={e.onCellDown}
              onCellEnter={e.onCellEnter}
              onEditEnd={e.finishEdit}
              onEditStart={e.startEdit}
            />
          );
        })}
      </div>
      <p className="text-xs text-[var(--os-text-muted)]">
        Clic o arrastre para seleccionar, Ctrl+C / Ctrl+V para copiar y pegar, Enter o doble clic para editar, Supr para borrar. {historicNote}
      </p>
      <EnginePreview e={e} />
    </div>
  );
}
