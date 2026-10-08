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
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CalendarWeek } from "@/lib/semanas-sheet/calendar-model";
import {
  anchorInRect,
  anchorOf,
  buildLayout,
  cellAt,
  copyRange,
  expandRect,
  makeRect,
  moveFrom,
  parseClipboard,
  planPaste,
  validateCalendarValue,
  type PlannedChange,
  type Pos,
  type Rect,
  type SkippedCell,
  type InvalidCell,
  type WeekLayout,
} from "@/lib/semanas-sheet/calendar-grid-model";

export interface CalendarCommitChange { a1: string; oldValue: string; newValue: string; reason?: string }
export interface CalendarCommitResult { ok: boolean; message?: string; failures: Array<{ a1: string; message: string }> }

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
const PREVIEW_THRESHOLD = 5;
const MIN_REASON = 8;

interface Sel { weekId: string; anchor: Pos; focus: Pos }
type Overlay = Record<string, { value: string; status: "saving" | "error" }>;

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

interface PreviewState { weekId: string; changes: PlannedChange[]; skipped: SkippedCell[]; invalid: InvalidCell[]; needsReason: boolean }

export function SemanasCalendarGrid({ weeks, dayWidths, canEdit, reasonRequiredBefore, historicNote, onCommit, focusWeekId, testId = "semanas-calendar", maxHeight = "72vh" }: SemanasCalendarGridProps) {
  const layouts = useMemo(() => new Map(weeks.map((w) => [w.id, buildLayout(w)] as const)), [weeks]);
  const [sel, setSel] = useState<Sel | null>(null);
  const [editing, setEditing] = useState<{ weekId: string; pos: Pos; initial: string } | null>(null);
  const [overlay, setOverlay] = useState<Overlay>({});
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const [barValue, setBarValue] = useState<string | null>(null);
  const dragging = useRef(false);
  const editingRef = useRef<typeof editing>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const overlayValues = useMemo(() => Object.fromEntries(Object.entries(overlay).map(([k, v]) => [k, v.value])), [overlay]);

  useEffect(() => {
    const stop = () => { dragging.current = false; };
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  // Semana actual a la vista al abrir.
  useEffect(() => {
    if (!focusWeekId) return;
    document.getElementById(`semanas-week-${focusWeekId}`)?.scrollIntoView?.({ block: "start" });
  }, [focusWeekId]);

  const layoutOf = useCallback((weekId: string) => layouts.get(weekId), [layouts]);
  const selRect = useMemo(() => {
    if (!sel) return null;
    const l = layouts.get(sel.weekId);
    return l ? expandRect(l, makeRect(sel.anchor, sel.focus)) : null;
  }, [sel, layouts]);
  const activeCell = useMemo(() => {
    if (!sel) return null;
    const l = layouts.get(sel.weekId);
    return l ? cellAt(l, sel.anchor) ?? null : null;
  }, [sel, layouts]);

  // ---- guardado ----
  const runCommit = useCallback(
    (changes: PlannedChange[], why?: string) => {
      if (changes.length === 0) return Promise.resolve();
      setNotice(null);
      setSaving(true);
      setOverlay((prev) => {
        const next = { ...prev };
        for (const c of changes) next[c.a1] = { value: c.newValue, status: "saving" };
        return next;
      });
      const job = queue.current.then(async () => {
        let result: CalendarCommitResult;
        try {
          result = await onCommit(changes.map((c) => ({ a1: c.a1, oldValue: c.oldValue, newValue: c.newValue, reason: why })));
        } catch (err) {
          result = { ok: false, message: err instanceof Error ? err.message : "Error de red al guardar.", failures: [] };
        }
        const failedA1 = new Set(result.failures.map((f) => f.a1));
        const allFailed = !result.ok && failedA1.size === 0;
        setOverlay((prev) => {
          const next = { ...prev };
          for (const c of changes) {
            if (allFailed || failedA1.has(c.a1)) next[c.a1] = { value: c.oldValue, status: "error" };
            else delete next[c.a1];
          }
          return next;
        });
        setSaving(false);
        if (result.ok) setLastSaved(changes.length);
        else {
          const first = result.failures[0];
          setNotice(first ? `No se guardó ${first.a1}: ${first.message}${result.failures.length > 1 ? ` (+${result.failures.length - 1} más)` : ""}` : (result.message ?? "No se pudo guardar."));
        }
      });
      queue.current = job.catch(() => undefined);
      return job;
    },
    [onCommit]
  );

  const request = useCallback(
    (weekId: string, changes: PlannedChange[], skipped: SkippedCell[], invalid: InvalidCell[]) => {
      if (changes.length === 0 && skipped.length === 0 && invalid.length === 0) return;
      const needsReason = changes.some((c) => c.date !== null && c.date < reasonRequiredBefore);
      const clean = changes.length > 0 && skipped.length === 0 && invalid.length === 0 && !needsReason && changes.length <= PREVIEW_THRESHOLD;
      if (clean) { void runCommit(changes); return; }
      setReason("");
      setPreview({ weekId, changes, skipped, invalid, needsReason });
    },
    [reasonRequiredBefore, runCommit]
  );

  // ---- selección ----
  const onCellDown = useCallback((weekId: string, pos: Pos, shift: boolean) => {
    dragging.current = true;
    editingRef.current = null;
    setEditing(null);
    setBarValue(null);
    setSel((prev) => (shift && prev && prev.weekId === weekId ? { ...prev, focus: pos } : { weekId, anchor: pos, focus: pos }));
    boxRef.current?.focus({ preventScroll: true });
  }, []);
  const onCellEnter = useCallback((weekId: string, pos: Pos) => {
    if (!dragging.current) return;
    setSel((prev) => (prev && prev.weekId === weekId ? { ...prev, focus: pos } : prev));
  }, []);

  const editableAt = useCallback(
    (weekId: string, pos: Pos): string | null => {
      const l = layoutOf(weekId);
      const c = l ? cellAt(l, pos) : undefined;
      if (!c) return "Sin celda.";
      if (!canEdit) return "Tu sector no puede editar esta planilla.";
      return c.protection;
    },
    [canEdit, layoutOf]
  );

  const startEdit = useCallback(
    (weekId: string, pos: Pos, initial?: string) => {
      const l = layoutOf(weekId);
      if (!l) return;
      const a = anchorOf(l, pos);
      const reasonProtected = editableAt(weekId, a);
      if (reasonProtected) { setNotice(`Celda protegida: ${reasonProtected}`); return; }
      const c = cellAt(l, a)!;
      setSel({ weekId, anchor: a, focus: a });
      const next = { weekId, pos: a, initial: initial ?? (overlayValues[c.a1] ?? c.value) };
      editingRef.current = next;
      setEditing(next);
    },
    [editableAt, layoutOf, overlayValues]
  );

  const finishEdit = useCallback(
    (commit: boolean, value: string, move: "down" | "right" | null) => {
      // Enter/Tab desmontan el input y el navegador puede disparar blur: la edición se cierra una sola vez.
      const ed = editingRef.current;
      editingRef.current = null;
      setEditing(null);
      if (!ed) return;
      const l = layoutOf(ed.weekId);
      if (!l) return;
      const cell = cellAt(l, ed.pos)!;
      if (commit) {
        const next = value.trim();
        const problem = validateCalendarValue(next);
        if (problem) setNotice(`No se guardó ${cell.a1}: ${problem}`);
        else if (next !== (overlayValues[cell.a1] ?? cell.value).trim()) request(ed.weekId, [{ a1: cell.a1, oldValue: cell.value, newValue: next, date: cell.date }], [], []);
      }
      if (move) {
        const to = moveFrom(l, ed.pos, move === "down" ? "ArrowDown" : "ArrowRight");
        setSel({ weekId: ed.weekId, anchor: to, focus: to });
      }
      boxRef.current?.focus({ preventScroll: true });
    },
    [layoutOf, overlayValues, request]
  );

  const clearSelection = useCallback(() => {
    if (!sel || !selRect) return;
    const l = layoutOf(sel.weekId)!;
    const changes: PlannedChange[] = [];
    const skipped: SkippedCell[] = [];
    for (let r = selRect.r0; r <= selRect.r1; r += 1) {
      for (let d = selRect.d0; d <= selRect.d1; d += 1) {
        const a = anchorOf(l, { ri: r, d });
        if (a.ri !== r || a.d !== d) continue;
        const c = cellAt(l, a)!;
        const why = !canEdit ? "Tu sector no puede editar esta planilla." : c.protection;
        if (why) { if (c.value.trim()) skipped.push({ a1: c.a1, reason: why }); continue; }
        if (c.value.trim()) changes.push({ a1: c.a1, oldValue: c.value, newValue: "", date: c.date });
      }
    }
    request(sel.weekId, changes, skipped, []);
  }, [sel, selRect, canEdit, request, layoutOf]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!sel || (e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;
    const l = layoutOf(sel.weekId);
    if (!l) return;
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      const to = moveFrom(l, e.shiftKey ? sel.focus : sel.anchor, e.key as "ArrowUp");
      setSel(e.shiftKey ? { ...sel, focus: to } : { weekId: sel.weekId, anchor: to, focus: to });
      return;
    }
    if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); startEdit(sel.weekId, sel.anchor); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); clearSelection(); return; }
    if (e.key === "Escape") { setSel(null); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); startEdit(sel.weekId, sel.anchor, e.key); }
  };

  const onCopy = (e: React.ClipboardEvent) => {
    if (!sel || !selRect || (e.target as HTMLElement).tagName === "INPUT") return;
    const l = layoutOf(sel.weekId);
    if (!l) return;
    e.clipboardData.setData("text/plain", copyRange(l, selRect, overlayValues));
    e.preventDefault();
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (!sel || !selRect || (e.target as HTMLElement).tagName === "INPUT") return;
    const l = layoutOf(sel.weekId);
    if (!l) return;
    e.preventDefault();
    const matrix = parseClipboard(e.clipboardData.getData("text/plain"));
    // Un único valor sobre un rango seleccionado se replica en todo el rango (como Excel).
    const single = matrix.length === 1 && matrix[0]!.length === 1;
    const rangeIsBigger = selRect.r1 > selRect.r0 || selRect.d1 > selRect.d0;
    const filled = single && rangeIsBigger ? Array.from({ length: selRect.r1 - selRect.r0 + 1 }, () => Array.from({ length: selRect.d1 - selRect.d0 + 1 }, () => matrix[0]![0]!)) : matrix;
    const plan = planPaste(l, { ri: selRect.r0, d: selRect.d0 }, filled, canEdit, overlayValues);
    request(sel.weekId, plan.changes, plan.skipped, plan.invalid);
  };

  // Barra de fórmulas (también es la vía cómoda en móviles).
  const barText = barValue ?? (activeCell ? (overlayValues[activeCell.a1] ?? activeCell.value) : "");
  const barLock = sel ? editableAt(sel.weekId, sel.anchor) : "Seleccioná una celda.";

  const confirmPreview = () => {
    if (!preview) return;
    if (preview.needsReason && reason.trim().length < MIN_REASON) return;
    const p = preview;
    setPreview(null);
    void runCommit(p.changes, preview.needsReason ? reason.trim() : undefined);
  };

  const widths = dayWidths.length === 5 ? dayWidths : [288, 288, 288, 288, 288];
  const lastRow = weeks.length;

  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-2 py-1.5 text-sm">
        <span className="min-w-[3rem] rounded bg-[var(--os-teal-soft)] px-2 py-0.5 text-center font-mono text-xs" data-testid="semanas-cal-a1">
          {activeCell?.a1 ?? "—"}
        </span>
        <input
          aria-label="Valor de la celda"
          data-testid="semanas-cal-bar"
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 py-1 focus:border-[var(--os-teal)] focus:outline-none disabled:opacity-60"
          value={barText}
          disabled={!sel || Boolean(barLock)}
          title={barLock ?? undefined}
          placeholder={barLock ? (barLock === "Seleccioná una celda." ? barLock : `🔒 ${barLock}`) : ""}
          onChange={(e) => setBarValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && sel && activeCell) {
              e.preventDefault();
              const next = (barValue ?? activeCell.value).trim();
              const problem = validateCalendarValue(next);
              setBarValue(null);
              if (problem) setNotice(`No se guardó ${activeCell.a1}: ${problem}`);
              else if (next !== activeCell.value.trim()) request(sel.weekId, [{ a1: activeCell.a1, oldValue: activeCell.value, newValue: next, date: activeCell.date }], [], []);
            } else if (e.key === "Escape") setBarValue(null);
          }}
          onBlur={() => setBarValue(null)}
        />
        <span className="text-xs text-[var(--os-text-muted)]" role="status" data-testid="semanas-cal-status">
          {saving ? "Guardando…" : lastSaved ? `Guardado (${lastSaved})` : ""}
        </span>
      </div>

      {notice && (
        <p className="rounded-[var(--os-radius-sm)] border border-[var(--genus-error)]/40 bg-[var(--genus-error-soft)] px-3 py-2 text-sm text-[var(--genus-error)]" role="alert" data-testid="semanas-cal-notice">
          {notice}
        </p>
      )}

      <div
        ref={boxRef}
        role="grid"
        aria-label="Calendario semanal"
        aria-rowcount={lastRow}
        tabIndex={0}
        className="relative overflow-auto rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-teal)]"
        style={{ maxHeight, overscrollBehavior: "contain" }}
        data-testid="semanas-cal-scroll"
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onPaste={onPaste}
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
              onCellDown={onCellDown}
              onCellEnter={onCellEnter}
              onEditEnd={finishEdit}
              onEditStart={startEdit}
            />
          );
        })}
      </div>

      <p className="text-xs text-[var(--os-text-muted)]">
        Clic o arrastre para seleccionar, Ctrl+C / Ctrl+V para copiar y pegar, Enter o doble clic para editar, Supr para borrar. {historicNote}
      </p>

      {preview && (
        <div role="dialog" aria-modal="true" aria-label="Confirmar cambios" data-testid="semanas-cal-preview" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[85vh] w-full max-w-lg space-y-3 overflow-auto rounded-[var(--os-radius)] bg-[var(--os-surface)] p-4 shadow-xl">
            <h3 className="text-base font-semibold">{preview.changes.length === 0 ? "No hay cambios para guardar" : `Se van a escribir ${preview.changes.length} celda(s) en la Sheet`}</h3>
            {preview.changes.length > 0 && (
              <ul className="max-h-40 space-y-1 overflow-auto text-sm">
                {preview.changes.slice(0, 30).map((c) => (
                  <li key={c.a1}>
                    <b className="font-mono">{c.a1}</b>: <span className="text-[var(--os-text-muted)]">{c.oldValue || "(vacío)"}</span> → <b>{c.newValue || "(vacío)"}</b>
                  </li>
                ))}
                {preview.changes.length > 30 && <li>… y {preview.changes.length - 30} más</li>}
              </ul>
            )}
            {preview.skipped.length > 0 && (
              <div className="text-sm" data-testid="semanas-cal-skipped">
                <p className="font-medium">{preview.skipped.length} celda(s) protegidas, se omiten:</p>
                <ul className="max-h-28 list-disc overflow-auto pl-5 text-[var(--os-text-muted)]">
                  {preview.skipped.slice(0, 10).map((s) => (
                    <li key={s.a1}><span className="font-mono">{s.a1}</span> — {s.reason}</li>
                  ))}
                </ul>
              </div>
            )}
            {preview.invalid.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-[var(--genus-error)]">
                {preview.invalid.slice(0, 10).map((s) => (
                  <li key={s.a1}><span className="font-mono">{s.a1}</span> — {s.message}</li>
                ))}
              </ul>
            )}
            {preview.needsReason && preview.changes.length > 0 && (
              <label className="block text-sm">
                Hay fechas anteriores a hoy: indicá el motivo (queda auditado).
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} data-testid="semanas-cal-reason" className="mt-1 w-full rounded border border-[var(--os-border)] bg-transparent p-2" rows={2} />
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setPreview(null)}>
                {preview.changes.length === 0 ? "Cerrar" : "Cancelar"}
              </Button>
              {preview.changes.length > 0 && (
                <Button type="button" variant="primary" onClick={confirmPreview} disabled={preview.needsReason && reason.trim().length < MIN_REASON} data-testid="semanas-cal-confirm">
                  Guardar
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
