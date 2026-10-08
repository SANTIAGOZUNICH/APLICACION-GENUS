"use client";

/**
 * Motor COMPARTIDO de edición del calendario de Semanas: selección de rangos, edición por celda, copiar/pegar con vista previa,
 * motivo en fechas históricas, rollback con error real y cola de guardado. Lo usan las dos vistas (Calendario operativo y Planilla)
 * para que tengan exactamente las mismas reglas y el mismo camino de guardado (onCommit → PATCH /api/v1/semanas/cells).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import type { CalendarWeek } from "@/lib/semanas-sheet/calendar-model";
import {
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
  type InvalidCell,
  type PlannedChange,
  type Pos,
  type SkippedCell,
} from "@/lib/semanas-sheet/calendar-grid-model";

export interface CalendarCommitChange { a1: string; oldValue: string; newValue: string; reason?: string }
export interface CalendarCommitResult { ok: boolean; message?: string; failures: Array<{ a1: string; message: string }> }

const PREVIEW_THRESHOLD = 5;
export const MIN_REASON = 8;

export interface Sel { weekId: string; anchor: Pos; focus: Pos }
export type Overlay = Record<string, { value: string; status: "saving" | "error" }>;
export interface PreviewState { weekId: string; changes: PlannedChange[]; skipped: SkippedCell[]; invalid: InvalidCell[]; needsReason: boolean }

export interface CalendarEngineProps {
  weeks: CalendarWeek[];
  canEdit: boolean;
  reasonRequiredBefore: string;
  onCommit: (changes: CalendarCommitChange[]) => Promise<CalendarCommitResult>;
  focusWeekId?: string | null;
  /** Navegación con flechas / Enter / Tab (por defecto, por coordenadas de la Sheet; el calendario operativo salta a líneas visibles). */
  move?: (layout: import("@/lib/semanas-sheet/calendar-grid-model").WeekLayout, from: Pos, key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight") => Pos;
}

export function useCalendarEngine(props: CalendarEngineProps) {
  const { weeks, canEdit, reasonRequiredBefore, onCommit, focusWeekId } = props;
  const moveFn = props.move ?? moveFrom;
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
        const to = moveFn(l, ed.pos, move === "down" ? "ArrowDown" : "ArrowRight");
        setSel({ weekId: ed.weekId, anchor: to, focus: to });
      }
      boxRef.current?.focus({ preventScroll: true });
    },
    [layoutOf, overlayValues, request, moveFn]
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
      const to = moveFn(l, e.shiftKey ? sel.focus : sel.anchor, e.key as "ArrowUp");
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

  return {
    layouts, layoutOf, sel, setSel, selRect, activeCell, editing, overlay, overlayValues, preview, setPreview, reason, setReason,
    notice, setNotice, saving, lastSaved, barText, barValue, setBarValue, barLock, boxRef, onCellDown, onCellEnter, startEdit, finishEdit,
    onKeyDown, onCopy, onPaste, confirmPreview, request, editableAt,
  };
}

export type CalendarEngine = ReturnType<typeof useCalendarEngine>;

/** Barra de valor (también es la vía cómoda de edición en móviles). */
export function EngineBar({ e }: { e: CalendarEngine }) {
  const { sel, activeCell, barText, barLock, barValue, setBarValue, setNotice, request, saving, lastSaved } = e;
  return (
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
  );
}

export function EngineNotice({ e }: { e: CalendarEngine }) {
  const { notice } = e;
  return (
    <>
      {notice && (
        <p className="rounded-[var(--os-radius-sm)] border border-[var(--genus-error)]/40 bg-[var(--genus-error-soft)] px-3 py-2 text-sm text-[var(--genus-error)]" role="alert" data-testid="semanas-cal-notice">
          {notice}
        </p>
      )}
    </>
  );
}

/** Vista previa de pegados masivos / fechas históricas / celdas protegidas. */
export function EnginePreview({ e }: { e: CalendarEngine }) {
  const { preview, setPreview, reason, setReason, confirmPreview } = e;
  return (
    <>
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
    </>
  );
}
