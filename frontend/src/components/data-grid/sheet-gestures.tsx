"use client";

/**
 * Gestos de la planilla de Materias Primas sobre el motor (react-datasheet-grid), que no los trae:
 *  1. CONTROLADOR DE RELLENO (esquina inferior derecha de la selección): se arrastra con mouse o con el dedo hacia
 *     abajo, arriba o a los costados; muestra el rango que se completará; autoscroll al llegar al borde.
 *  2. SELECCIÓN TÁCTIL de rangos: mantener apretada una celda y arrastrar (el motor solo selecciona con mouse).
 * Toda la geometría sale del DOM real del motor (celdas de encabezado con clase `genus-col-<n>`) y de la altura fija de
 * fila; nunca se asume el ancho de columnas (las celdas están virtualizadas).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { DataSheetGridRef } from "react-datasheet-grid";

export interface SheetCell {
  col: number;
  row: number;
}
export interface SheetRange {
  min: SheetCell;
  max: SheetCell;
}
export interface FillPlan {
  source: SheetRange;
  axis: "v" | "h";
  /** 1 = abajo/derecha, -1 = arriba/izquierda. */
  direction: 1 | -1;
  /** Celdas a completar (rango rectangular, SIN el origen). */
  target: SheetRange;
  /** Ctrl/⌘ apretado al soltar: invierte copiar ↔ serie (como Excel). */
  invert: boolean;
}

interface Props {
  wrapRef: React.RefObject<HTMLDivElement | null>;
  gridRef: React.RefObject<DataSheetGridRef | null>;
  rowHeight: number;
  rowCount: number;
  colCount: number;
  /** Selección actual del motor (celda activa si no hay rango). */
  selectionRef: React.RefObject<SheetRange | null>;
  /** false → solo lectura: sin controlador de relleno. */
  canFill: boolean;
  onFill: (plan: FillPlan) => void;
  testId: string;
}

const EDGE = 56;
const colOf = (el: Element): number | null => {
  const m = /(?:^|\s)genus-col-(\d+)(?:\s|$)/.exec(el.className.toString());
  return m ? Number(m[1]) : null;
};

export function useSheetGestures({ wrapRef, gridRef, rowHeight, rowCount, colCount, selectionRef, canFill, onFill, testId }: Props): { overlay: ReactNode; dragging: boolean } {
  const [handle, setHandle] = useState<{ left: number; top: number } | null>(null);
  const [preview, setPreview] = useState<{ left: number; top: number; width: number; height: number; label: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ plan: FillPlan | null; x: number; y: number; source: SheetRange; ctrl: boolean } | null>(null);
  const touchSel = useRef<{ anchor: SheetCell; x: number; y: number; active: boolean; timer: number | null; startX: number; startY: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  const scroller = useCallback(() => wrapRef.current?.querySelector<HTMLElement>(".dsg-container") ?? null, [wrapRef]);

  /** Encabezados renderizados: índice de columna → rectángulo en pantalla. */
  const headerRects = useCallback(() => {
    const s = scroller();
    const out = new Map<number, DOMRect>();
    if (!s) return out;
    for (const el of Array.from(s.querySelectorAll(".dsg-row-header .dsg-cell"))) {
      const c = colOf(el);
      if (c !== null) out.set(c, el.getBoundingClientRect());
    }
    return out;
  }, [scroller]);

  const cellAt = useCallback(
    (x: number, y: number): SheetCell | null => {
      const s = scroller();
      if (!s || rowCount === 0 || colCount === 0) return null;
      const sr = s.getBoundingClientRect();
      const contentTop = sr.top - s.scrollTop;
      const row = Math.max(0, Math.min(rowCount - 1, Math.floor((y - contentTop) / rowHeight) - 1));
      const rects = headerRects();
      if (rects.size === 0) return null;
      let col: number | null = null;
      let best = Infinity;
      for (const [c, r] of rects) {
        const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
        if (d < best || (d === best && col !== null && c < col)) {
          best = d;
          col = c;
        }
        if (d === 0) break;
      }
      return col === null ? null : { row, col: Math.max(0, Math.min(colCount - 1, col)) };
    },
    [scroller, rowCount, colCount, rowHeight, headerRects]
  );

  const autoscroll = useCallback(
    (x: number, y: number) => {
      const s = scroller();
      if (!s) return;
      const sr = s.getBoundingClientRect();
      const speed = (d: number) => Math.min(28, Math.max(4, ((EDGE - d) / EDGE) * 28));
      const top = sr.top + rowHeight; // el encabezado ocupa la primera fila
      if (y > sr.bottom - EDGE) s.scrollTop += speed(Math.max(0, sr.bottom - y));
      else if (y < top + EDGE) s.scrollTop -= speed(Math.max(0, y - top));
      if (x > sr.right - EDGE) s.scrollLeft += speed(Math.max(0, sr.right - x));
      else if (x < sr.left + 44 + EDGE) s.scrollLeft -= speed(Math.max(0, x - sr.left - 44));
    },
    [scroller, rowHeight]
  );

  const planFor = useCallback(
    (source: SheetRange, cell: SheetCell): FillPlan | null => {
      const dRow = cell.row > source.max.row ? cell.row - source.max.row : cell.row < source.min.row ? cell.row - source.min.row : 0;
      const dCol = cell.col > source.max.col ? cell.col - source.max.col : cell.col < source.min.col ? cell.col - source.min.col : 0;
      if (dRow === 0 && dCol === 0) return null;
      const vertical = Math.abs(dRow) >= Math.abs(dCol);
      if (vertical) {
        return {
          source,
          axis: "v",
          direction: dRow > 0 ? 1 : -1,
          target: dRow > 0
            ? { min: { row: source.max.row + 1, col: source.min.col }, max: { row: cell.row, col: source.max.col } }
            : { min: { row: cell.row, col: source.min.col }, max: { row: source.min.row - 1, col: source.max.col } },
          invert: false,
        };
      }
      return {
        source,
        axis: "h",
        direction: dCol > 0 ? 1 : -1,
        target: dCol > 0
          ? { min: { row: source.min.row, col: source.max.col + 1 }, max: { row: source.max.row, col: cell.col } }
          : { min: { row: source.min.row, col: cell.col }, max: { row: source.max.row, col: source.min.col - 1 } },
        invert: false,
      };
    },
    []
  );

  const rectOf = useCallback(
    (range: SheetRange) => {
      const s = scroller();
      const wrap = wrapRef.current;
      if (!s || !wrap) return null;
      const sr = s.getBoundingClientRect();
      const fr = wrap.getBoundingClientRect();
      const rects = headerRects();
      const cols = [...rects.keys()].sort((a, b) => a - b);
      if (cols.length === 0) return null;
      const lo = Math.max(range.min.col, cols[0]!);
      const hi = Math.min(range.max.col, cols[cols.length - 1]!);
      const rLo = rects.get(lo) ?? rects.get(cols[0]!)!;
      const rHi = rects.get(hi) ?? rects.get(cols[cols.length - 1]!)!;
      const contentTop = sr.top - s.scrollTop;
      const top = contentTop + rowHeight * (range.min.row + 1);
      const bottom = contentTop + rowHeight * (range.max.row + 2);
      const clip = {
        left: Math.max(rLo.left, sr.left),
        right: Math.min(rHi.right, sr.right),
        top: Math.max(top, sr.top + rowHeight),
        bottom: Math.min(bottom, sr.bottom),
      };
      return {
        left: clip.left - fr.left,
        top: clip.top - fr.top,
        width: Math.max(0, clip.right - clip.left),
        height: Math.max(0, clip.bottom - clip.top),
        // sin recortar: para ubicar el controlador de relleno
        fullRight: rHi.right - fr.left,
        fullBottom: bottom - fr.top,
        visible: rHi.right > sr.left && rHi.right <= sr.right + 1 && bottom > sr.top + rowHeight && bottom <= sr.bottom + 1,
      };
    },
    [scroller, wrapRef, rowHeight, headerRects]
  );

  // ---- posición del controlador (sigue la selección y el scroll) ----
  useEffect(() => {
    if (!canFill) return;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const sel = selectionRef.current;
      if (!sel || dragRef.current) {
        if (!dragRef.current) setHandle((h) => (h ? null : h));
      } else {
        const r = rectOf(sel);
        setHandle((prev) => {
          if (!r || !r.visible) return prev ? null : prev;
          const next = { left: Math.round(r.fullRight), top: Math.round(r.fullBottom) };
          return prev && prev.left === next.left && prev.top === next.top ? prev : next;
        });
      }
      rafRef.current = window.requestAnimationFrame(tick);
    };
    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      alive = false;
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    };
  }, [canFill, rectOf, selectionRef]);

  // ---- arrastre del controlador ----
  const frameRef = useRef<() => void>(() => {});
  useEffect(() => {
    frameRef.current = () => {
      const d = dragRef.current;
      if (!d) return;
      autoscroll(d.x, d.y);
      const cell = cellAt(d.x, d.y);
      const plan = cell ? planFor(d.source, cell) : null;
      d.plan = plan;
      if (plan) {
        const r = rectOf(plan.target);
        const cells = (plan.target.max.row - plan.target.min.row + 1) * (plan.target.max.col - plan.target.min.col + 1);
        setPreview(r ? { left: r.left, top: r.top, width: r.width, height: r.height, label: `${cells} celda${cells === 1 ? "" : "s"}` } : null);
      } else setPreview(null);
      window.requestAnimationFrame(() => frameRef.current());
    };
  }, [autoscroll, cellAt, planFor, rectOf]);

  const onHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const sel = selectionRef.current;
    if (!sel) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { plan: null, x: e.clientX, y: e.clientY, source: sel, ctrl: e.ctrlKey || e.metaKey };
    setDragging(true);
    window.requestAnimationFrame(() => frameRef.current());
  };
  const onHandleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    d.x = e.clientX;
    d.y = e.clientY;
    d.ctrl = e.ctrlKey || e.metaKey;
  };
  const finish = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    setPreview(null);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ya liberado */
    }
    if (!d || cancelled) return;
    // Ubicación final exacta (el último frame puede estar atrasado).
    const cell = cellAt(e.clientX, e.clientY);
    const plan = (cell ? planFor(d.source, cell) : null) ?? d.plan;
    if (plan) {
      onFill({ ...plan, invert: e.ctrlKey || e.metaKey || d.ctrl });
      // La selección pasa a abarcar origen + relleno (como Excel).
      const union: SheetRange = {
        min: { row: Math.min(d.source.min.row, plan.target.min.row), col: Math.min(d.source.min.col, plan.target.min.col) },
        max: { row: Math.max(d.source.max.row, plan.target.max.row), col: Math.max(d.source.max.col, plan.target.max.col) },
      };
      window.setTimeout(() => gridRef.current?.setSelection(union), 0);
    }
  };

  // ---- selección táctil de rangos (mantener + arrastrar) ----
  useEffect(() => {
    const s = scroller();
    if (!s) return;
    const LONG_PRESS_MS = 380;
    const stop = () => {
      const t = touchSel.current;
      if (t?.timer) window.clearTimeout(t.timer);
      touchSel.current = null;
      s.style.removeProperty("touch-action");
    };
    const loop = () => {
      const t = touchSel.current;
      if (!t || !t.active) return;
      autoscroll(t.x, t.y);
      const cell = cellAt(t.x, t.y);
      if (cell) {
        gridRef.current?.setSelection({
          min: { row: Math.min(t.anchor.row, cell.row), col: Math.min(t.anchor.col, cell.col) },
          max: { row: Math.max(t.anchor.row, cell.row), col: Math.max(t.anchor.col, cell.col) },
        });
      }
      window.requestAnimationFrame(loop);
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || (e.target as HTMLElement).closest(".genus-sheet-handle")) return;
      const anchor = cellAt(e.clientX, e.clientY);
      if (!anchor) return;
      stop();
      const state = { anchor, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, active: false, timer: null as number | null };
      state.timer = window.setTimeout(() => {
        if (touchSel.current !== state) return;
        state.active = true;
        gridRef.current?.setActiveCell(anchor);
        navigator.vibrate?.(12);
        window.requestAnimationFrame(loop);
      }, LONG_PRESS_MS);
      touchSel.current = state;
    };
    const onMove = (e: PointerEvent) => {
      const t = touchSel.current;
      if (!t || e.pointerType !== "touch") return;
      t.x = e.clientX;
      t.y = e.clientY;
      if (!t.active && Math.hypot(e.clientX - t.startX, e.clientY - t.startY) > 10) {
        if (t.timer) window.clearTimeout(t.timer);
        touchSel.current = null; // el dedo se movió antes de tiempo: es un desplazamiento normal
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (touchSel.current?.active && e.cancelable) e.preventDefault(); // no desplazar mientras se selecciona
    };
    const onContext = (e: Event) => {
      if (touchSel.current) e.preventDefault();
    };
    s.addEventListener("pointerdown", onDown);
    s.addEventListener("pointermove", onMove);
    s.addEventListener("pointerup", stop);
    s.addEventListener("pointercancel", stop);
    s.addEventListener("touchmove", onTouchMove, { passive: false });
    s.addEventListener("contextmenu", onContext);
    return () => {
      stop();
      s.removeEventListener("pointerdown", onDown);
      s.removeEventListener("pointermove", onMove);
      s.removeEventListener("pointerup", stop);
      s.removeEventListener("pointercancel", stop);
      s.removeEventListener("touchmove", onTouchMove);
      s.removeEventListener("contextmenu", onContext);
    };
  }, [scroller, autoscroll, cellAt, gridRef, rowCount, colCount]);

  const overlay = (
    <div className="genus-sheet-overlay" aria-hidden={handle ? undefined : "true"} data-testid={`${testId}-overlay`}>
      {preview ? (
        <div
          className="genus-sheet-fill-preview"
          style={{ left: preview.left, top: preview.top, width: preview.width, height: preview.height }}
          data-testid={`${testId}-fill-preview`}
        >
          <span className="genus-sheet-fill-label">{preview.label}</span>
        </div>
      ) : null}
      {canFill && handle ? (
        <div
          className="genus-sheet-handle"
          style={{ left: handle.left, top: handle.top }}
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={(e) => finish(e, false)}
          onPointerCancel={(e) => finish(e, true)}
          data-testid={`${testId}-fill-handle`}
          role="button"
          aria-label="Controlador de relleno: arrastrá para completar celdas"
          title="Arrastrá para completar (serie o copia)"
        >
          <span className="genus-sheet-handle-dot" />
        </div>
      ) : null}
    </div>
  );
  return { overlay, dragging };
}
