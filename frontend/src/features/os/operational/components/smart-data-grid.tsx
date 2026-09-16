"use client";

import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * Grilla reutilizable para tablas/listas grandes — piloto: Smart Paste
 * (Asignación de Lotes), pensada para reusarse en cualquier lista grande de
 * GENUS OS de acá en más.
 *
 * Decisiones deliberadas (ver informe Smart Paste):
 * - El zoom escala `font-size`/padding vía una variable CSS, NUNCA la
 *   propiedad `zoom` ni `transform: scale` — ambas rompen coordenadas de
 *   click, inputs y accesibilidad. Con font-size relativo (`em`), todo el
 *   contenido (inputs incluidos) escala de forma segura.
 * - La virtualización es manual (ventana de filas visibles + padding), sin
 *   sumar una dependencia nueva — el volumen esperado (cientos/pocos miles
 *   de filas de un pegado) no justifica una librería de virtualización.
 */

export type SmartGridDensity = "compacta" | "normal";
export type SmartGridZoom = 70 | 80 | 90 | 100 | 110;
export type SmartGridCellStatus = "valido" | "revisar" | "error" | "duplicado" | "neutro";

export interface SmartGridColumn<T> {
  key: string;
  label: string;
  /** Ancho inicial en px — el usuario puede redimensionar arrastrando el borde. */
  width?: number;
  minWidth?: number;
  render: (row: T) => ReactNode;
  /** Texto plano para tooltip/título cuando se trunca — si no se pasa, se usa render() como string. */
  cellText?: (row: T) => string;
  status?: (row: T) => SmartGridCellStatus | undefined;
  reason?: (row: T) => string | undefined;
}

export interface SmartDataGridProps<T> {
  columns: SmartGridColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Cantidad de columnas iniciales fijas al hacer scroll horizontal (además del header, que siempre es sticky). */
  stickyColumns?: number;
  emptyMessage?: string;
  /** A partir de cuántas filas se activa la virtualización manual. */
  virtualizeThreshold?: number;
  rowStatus?: (row: T) => SmartGridCellStatus | undefined;
  onSelectRow?: (row: T) => void;
  className?: string;
}

const STATUS_BG: Record<SmartGridCellStatus, string> = {
  valido: "transparent",
  revisar: "var(--genus-warning-soft)",
  error: "var(--genus-error-soft)",
  duplicado: "var(--os-bg)",
  neutro: "transparent",
};

const STATUS_TEXT: Record<SmartGridCellStatus, string> = {
  valido: "inherit",
  revisar: "var(--genus-warning)",
  error: "var(--genus-error)",
  duplicado: "var(--os-text-muted)",
  neutro: "inherit",
};

const ROW_HEIGHT_PX: Record<SmartGridDensity, number> = {
  compacta: 28,
  normal: 36,
};

const ZOOM_LEVELS: SmartGridZoom[] = [70, 80, 90, 100, 110];

export function SmartDataGrid<T>({
  columns,
  rows,
  rowKey,
  stickyColumns = 0,
  emptyMessage = "Sin filas.",
  virtualizeThreshold = 150,
  rowStatus,
  onSelectRow,
  className,
}: SmartDataGridProps<T>) {
  const [density, setDensity] = useState<SmartGridDensity>("normal");
  const [zoom, setZoom] = useState<SmartGridZoom>(100);
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    for (const col of columns) initial[col.key] = col.width ?? 160;
    return initial;
  });
  const [fitToScreen, setFitToScreen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);

  const rowHeight = ROW_HEIGHT_PX[density] * (zoom / 100);

  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

  function onResizeStart(key: string, e: React.PointerEvent) {
    resizingRef.current = { key, startX: e.clientX, startWidth: widths[key] ?? 160 };
    const move = (ev: PointerEvent) => {
      const state = resizingRef.current;
      if (!state) return;
      const next = Math.max(state.startWidth + (ev.clientX - state.startX), 60);
      setWidths((prev) => ({ ...prev, [state.key]: next }));
    };
    const up = () => {
      resizingRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function fitColumnsToScreen() {
    const container = scrollRef.current;
    if (!container) return;
    const available = container.clientWidth - 4;
    const min = columns.reduce((sum, c) => sum + (c.minWidth ?? 80), 0);
    if (available <= min) {
      const next: Record<string, number> = {};
      for (const c of columns) next[c.key] = c.minWidth ?? 80;
      setWidths(next);
      return;
    }
    const extra = available - min;
    const perCol = extra / columns.length;
    const next: Record<string, number> = {};
    for (const c of columns) next[c.key] = (c.minWidth ?? 80) + perCol;
    setWidths(next);
    setFitToScreen(true);
  }

  const shouldVirtualize = rows.length > virtualizeThreshold;
  const overscan = 10;
  const visibleRange = useMemo(() => {
    if (!shouldVirtualize) return { start: 0, end: rows.length };
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
    const end = Math.min(rows.length, start + visibleCount);
    return { start, end };
  }, [shouldVirtualize, scrollTop, viewportHeight, rowHeight, rows.length]);

  const topPad = shouldVirtualize ? visibleRange.start * rowHeight : 0;
  const bottomPad = shouldVirtualize ? (rows.length - visibleRange.end) * rowHeight : 0;
  const visibleRows = shouldVirtualize ? rows.slice(visibleRange.start, visibleRange.end) : rows;

  const gridStyle: CSSProperties = {
    fontSize: `${zoom / 100}em`,
  };

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <div className="inline-flex overflow-hidden rounded border border-[var(--os-border)]">
          {(["compacta", "normal"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDensity(d)}
              data-testid={`smart-grid-density-${d}`}
              className={`px-2 py-1 ${density === d ? "bg-[var(--os-teal)] text-white" : "bg-[var(--os-surface)]"}`}
            >
              {d === "compacta" ? "Compacta" : "Normal"}
            </button>
          ))}
        </div>
        <div className="inline-flex overflow-hidden rounded border border-[var(--os-border)]">
          {ZOOM_LEVELS.map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => setZoom(z)}
              data-testid={`smart-grid-zoom-${z}`}
              className={`px-2 py-1 tabular-nums ${zoom === z ? "bg-[var(--os-teal)] text-white" : "bg-[var(--os-surface)]"}`}
            >
              {z}%
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={fitColumnsToScreen}
          data-testid="smart-grid-fit-to-screen"
          className={`rounded border border-[var(--os-border)] px-2 py-1 ${fitToScreen ? "bg-[var(--os-teal)] text-white" : "bg-[var(--os-surface)]"}`}
        >
          Ajustar a pantalla
        </button>
        {shouldVirtualize && (
          <span className="text-[var(--os-text-muted)]" data-testid="smart-grid-virtualized-hint">
            {rows.length} filas — virtualizado
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          setScrollTop(e.currentTarget.scrollTop);
          setViewportHeight(e.currentTarget.clientHeight);
        }}
        className="max-h-[60vh] overflow-auto rounded border border-[var(--os-border)]"
        style={gridStyle}
        data-testid="smart-grid-scroll"
      >
        <table className="border-collapse" style={{ tableLayout: "fixed", width: "100%" }}>
          <thead>
            <tr>
              {columns.map((col, colIdx) => (
                <th
                  key={col.key}
                  className="sticky top-0 z-10 border-b border-[var(--os-border)] bg-[var(--os-bg)] px-2 text-left text-[0.8em] font-semibold uppercase tracking-wide text-[var(--os-text-muted)]"
                  style={{
                    width: widths[col.key],
                    minWidth: col.minWidth ?? 60,
                    height: rowHeight,
                    left: colIdx < stickyColumns ? stickyOffset(columns, widths, colIdx) : undefined,
                    position: colIdx < stickyColumns ? "sticky" : undefined,
                    zIndex: colIdx < stickyColumns ? 20 : 10,
                  }}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate" title={col.label}>
                      {col.label}
                    </span>
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      onPointerDown={(e) => onResizeStart(col.key, e)}
                      className="ml-1 h-full w-1 shrink-0 cursor-col-resize select-none opacity-0 hover:opacity-100"
                      data-testid={`smart-grid-resize-${col.key}`}
                    />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-[var(--os-text-muted)]">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              <>
                {topPad > 0 && (
                  <tr aria-hidden style={{ height: topPad }}>
                    <td colSpan={columns.length} />
                  </tr>
                )}
                {visibleRows.map((row) => {
                  const status = rowStatus?.(row) ?? "neutro";
                  return (
                    <tr
                      key={rowKey(row)}
                      onClick={() => onSelectRow?.(row)}
                      style={{ height: rowHeight, background: STATUS_BG[status] }}
                      className={onSelectRow ? "cursor-pointer hover:brightness-95" : undefined}
                      data-testid="smart-grid-row"
                      data-status={status}
                    >
                      {columns.map((col, colIdx) => {
                        const cellStatus = col.status?.(row);
                        const reason = col.reason?.(row);
                        const text = col.cellText?.(row);
                        return (
                          <td
                            key={col.key}
                            title={reason ?? text}
                            className="max-w-0 truncate border-b border-[var(--os-border-subtle)] px-2 text-[0.9em]"
                            style={{
                              width: widths[col.key],
                              color: cellStatus ? STATUS_TEXT[cellStatus] : undefined,
                              background: cellStatus ? STATUS_BG[cellStatus] : undefined,
                              left: colIdx < stickyColumns ? stickyOffset(columns, widths, colIdx) : undefined,
                              position: colIdx < stickyColumns ? "sticky" : undefined,
                              zIndex: colIdx < stickyColumns ? 5 : undefined,
                            }}
                          >
                            {col.render(row)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {bottomPad > 0 && (
                  <tr aria-hidden style={{ height: bottomPad }}>
                    <td colSpan={columns.length} />
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function stickyOffset<T>(columns: SmartGridColumn<T>[], widths: Record<string, number>, index: number): number {
  let offset = 0;
  for (let i = 0; i < index; i++) offset += widths[columns[i]!.key] ?? columns[i]!.width ?? 160;
  return offset;
}
