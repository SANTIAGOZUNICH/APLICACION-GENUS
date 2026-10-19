"use client";

/**
 * Barras de desplazamiento propias para la planilla (Materias Primas): SIEMPRE visibles, gruesas y arrastrables con
 * mouse o con el dedo (tablets Android), sincronizadas con el desplazamiento real del motor de la grilla.
 *  - Horizontal: fija debajo del marco de la hoja (no hay que bajar cientos de filas para encontrarla).
 *  - Vertical: pegada al borde derecho del marco.
 * El motor oculta sus barras nativas (ver genus-grid.css `.genus-sheet`): así no hay dos barras desincronizadas.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export const SHEET_BAR_SIZE = 22;
const MIN_THUMB = 48;

interface Metrics {
  scrollPos: number;
  scrollSize: number;
  clientSize: number;
}

function useScrollMetrics(scroller: HTMLElement | null, axis: "x" | "y") {
  const [m, setM] = useState<Metrics>({ scrollPos: 0, scrollSize: 0, clientSize: 0 });
  useEffect(() => {
    if (!scroller) return;
    const read = () =>
      setM((prev) => {
        const next =
          axis === "x"
            ? { scrollPos: scroller.scrollLeft, scrollSize: scroller.scrollWidth, clientSize: scroller.clientWidth }
            : { scrollPos: scroller.scrollTop, scrollSize: scroller.scrollHeight, clientSize: scroller.clientHeight };
        return prev.scrollPos === next.scrollPos && prev.scrollSize === next.scrollSize && prev.clientSize === next.clientSize ? prev : next;
      });
    read();
    scroller.addEventListener("scroll", read, { passive: true });
    const ro = new ResizeObserver(read);
    ro.observe(scroller);
    for (const child of Array.from(scroller.children)) ro.observe(child);
    // El contenido (columnas/filas) puede cambiar sin cambiar el tamaño del marco: se relee con baja frecuencia.
    const interval = window.setInterval(read, 500);
    return () => {
      scroller.removeEventListener("scroll", read);
      ro.disconnect();
      window.clearInterval(interval);
    };
  }, [scroller, axis]);
  return m;
}

function Bar({ scroller, axis, testId }: { scroller: HTMLElement | null; axis: "x" | "y"; testId: string }) {
  const m = useScrollMetrics(scroller, axis);
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackLen, setTrackLen] = useState(0);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const read = () => setTrackLen(axis === "x" ? el.clientWidth : el.clientHeight);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [axis]);
  const drag = useRef<{ startPointer: number; startScroll: number } | null>(null);
  const horizontal = axis === "x";
  const scrollable = m.scrollSize > m.clientSize + 1;
  const thumbLen = scrollable ? Math.max(MIN_THUMB, Math.round((m.clientSize / m.scrollSize) * trackLen)) : trackLen;
  const maxScroll = Math.max(1, m.scrollSize - m.clientSize);
  const thumbPos = scrollable ? Math.round((m.scrollPos / maxScroll) * Math.max(0, trackLen - thumbLen)) : 0;

  const setScroll = useCallback(
    (value: number) => {
      if (!scroller) return;
      const clamped = Math.max(0, Math.min(maxScroll, value));
      scroller.scrollTo(horizontal ? { left: clamped } : { top: clamped });
    },
    [scroller, horizontal, maxScroll]
  );

  const onThumbDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startPointer: horizontal ? e.clientX : e.clientY, startScroll: m.scrollPos };
  };
  const onThumbMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const delta = (horizontal ? e.clientX : e.clientY) - d.startPointer;
    const free = Math.max(1, trackLen - thumbLen);
    setScroll(d.startScroll + (delta / free) * maxScroll);
  };
  const onThumbUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ya liberado */
    }
  };
  /** Tocar la pista fuera del pulgar: avanza una página hacia ese lado. */
  const onTrackDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = (horizontal ? e.clientX - rect.left : e.clientY - rect.top) - thumbLen / 2;
    const free = Math.max(1, trackLen - thumbLen);
    setScroll((pos / free) * maxScroll);
  };

  return (
    <div
      ref={trackRef}
      className={`genus-sheet-bar genus-sheet-bar-${axis}`}
      style={horizontal ? { height: SHEET_BAR_SIZE } : { width: SHEET_BAR_SIZE }}
      onPointerDown={onTrackDown}
      data-testid={testId}
      data-scrollable={scrollable ? "true" : "false"}
      role="scrollbar"
      aria-orientation={horizontal ? "horizontal" : "vertical"}
      aria-valuenow={Math.round(m.scrollPos)}
      aria-valuemin={0}
      aria-valuemax={Math.round(maxScroll)}
    >
      {scrollable ? (
        <div
          className="genus-sheet-thumb"
          data-testid={`${testId}-thumb`}
          style={horizontal ? { width: thumbLen, transform: `translateX(${thumbPos}px)` } : { height: thumbLen, transform: `translateY(${thumbPos}px)` }}
          onPointerDown={onThumbDown}
          onPointerMove={onThumbMove}
          onPointerUp={onThumbUp}
          onPointerCancel={onThumbUp}
        />
      ) : null}
    </div>
  );
}

/** Barra horizontal fija (debajo del marco). */
export function SheetHScrollbar({ scroller, testId }: { scroller: HTMLElement | null; testId: string }) {
  return <Bar scroller={scroller} axis="x" testId={`${testId}-hscroll`} />;
}
/** Barra vertical (al costado del marco). */
export function SheetVScrollbar({ scroller, testId }: { scroller: HTMLElement | null; testId: string }) {
  return <Bar scroller={scroller} axis="y" testId={`${testId}-vscroll`} />;
}
