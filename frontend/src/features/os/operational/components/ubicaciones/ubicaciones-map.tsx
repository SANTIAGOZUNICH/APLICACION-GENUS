"use client";

/**
 * Mapa 2D (SVG) de ubicaciones. Todo viene de la base: contorno en L, pasillos, escalera, vacío y posiciones. Mismo componente en Depósito
 * (con acciones) y en Envasado (consulta). Zoom con botones (+ / − / ajustar), arrastre para desplazar y pinch en pantallas táctiles.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { cellState, clientsLabel, type CellState } from "@/lib/ubicaciones/rules";
import type { MapConfigView, ShapeView, UbicacionView } from "@/lib/ubicaciones/types";

const PAD = 8;
const MIN_SCALE = 1;
const MAX_SCALE = 4;

export const CELL_STYLE: Record<CellState, { fill: string; stroke: string; text: string; label: string }> = {
  LIBRE: { fill: "var(--ubi-libre, #bbf7d0)", stroke: "var(--ubi-libre-stroke, #16a34a)", text: "#0f172a", label: "Libre" },
  OCUPADA: { fill: "var(--ubi-ocupada, #fde68a)", stroke: "var(--ubi-ocupada-stroke, #d97706)", text: "#0f172a", label: "Ocupada" },
  SELECCIONADA: { fill: "var(--ubi-seleccionada, #1e40af)", stroke: "#0b1f3a", text: "#ffffff", label: "Seleccionada" },
  RESULTADO: { fill: "var(--ubi-resultado, #7dd3fc)", stroke: "var(--ubi-resultado-stroke, #0284c7)", text: "#0f172a", label: "Resultado de búsqueda" },
  INACTIVA: { fill: "#e2e8f0", stroke: "#94a3b8", text: "#64748b", label: "Inactiva" },
};

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s);

function ShapeNode({ s }: { s: ShapeView }) {
  const wall = "var(--ubi-wall, #0b1f3a)";
  if (s.kind === "CONTORNO" && s.points) {
    return <polygon points={s.points.map((p) => p.join(",")).join(" ")} fill="var(--ubi-floor, #f1f5f9)" stroke={wall} strokeWidth={3} strokeLinejoin="round" data-testid="ubi-shape-contorno" />;
  }
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  if (s.kind === "VACIO") {
    return (
      <g data-testid="ubi-shape-vacio">
        <rect x={s.x} y={s.y} width={s.w} height={s.h} fill="var(--ubi-vacio, #e5e9ef)" stroke={wall} strokeWidth={2} />
        <line x1={s.x} y1={s.y} x2={s.x + s.w} y2={s.y + s.h} stroke="#94a3b8" strokeWidth={0.8} />
        <line x1={s.x + s.w} y1={s.y} x2={s.x} y2={s.y + s.h} stroke="#94a3b8" strokeWidth={0.8} />
        <rect x={cx - 62} y={cy - 24} width={124} height={48} rx={6} fill="var(--ubi-floor, #f1f5f9)" opacity={0.92} />
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize={13} fontWeight={800} fill="#475569" letterSpacing={0.5}>{s.label}</text>
        {s.sublabel ? <text x={cx} y={cy + 14} textAnchor="middle" fontSize={9.5} fill="#64748b">{s.sublabel}</text> : null}
      </g>
    );
  }
  if (s.kind === "ESCALERA") {
    const steps = Math.max(3, Math.floor(s.h / 5));
    return (
      <g data-testid="ubi-shape-escalera">
        <rect x={s.x} y={s.y} width={s.w} height={s.h} fill="#fff" stroke={wall} strokeWidth={1.6} />
        {Array.from({ length: steps }, (_, i) => <line key={i} x1={s.x} x2={s.x + s.w} y1={s.y + ((i + 1) * s.h) / (steps + 1)} y2={s.y + ((i + 1) * s.h) / (steps + 1)} stroke="#475569" strokeWidth={0.7} />)}
        <path d={`M ${cx} ${s.y + s.h - 6} L ${cx} ${s.y + 8} M ${cx - 5} ${s.y + 14} L ${cx} ${s.y + 8} L ${cx + 5} ${s.y + 14}`} stroke={wall} strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {s.label ? <text x={s.x + s.w + 6} y={cy - 2} fontSize={9.5} fontWeight={800} fill="#0f172a">{s.label}</text> : null}
        {s.sublabel ? <text x={s.x + s.w + 6} y={cy + 9} fontSize={6.6} fill="#475569">{s.sublabel}</text> : null}
      </g>
    );
  }
  // PASILLO
  return (
    <g data-testid="ubi-shape-pasillo">
      <rect x={s.x} y={s.y} width={s.w} height={s.h} fill="var(--ubi-pasillo, #dde3ea)" stroke="#94a3b8" strokeWidth={0.8} strokeDasharray="4 3" />
      {s.label ? (
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={10} fontWeight={700} fill="#64748b" letterSpacing={1.5} transform={`rotate(${s.rotation} ${cx} ${cy})`}>{s.label}</text>
      ) : null}
      {s.label && s.rotation === -90 ? (
        <>
          <path d={`M ${cx} ${s.y + 24} l -4 7 h 8 z`} fill="#94a3b8" />
          <path d={`M ${cx} ${s.y + s.h - 24} l -4 -7 h 8 z`} fill="#94a3b8" />
        </>
      ) : null}
    </g>
  );
}

export function UbicacionesMap({
  config,
  shapes,
  locations,
  selectedId,
  matchIds,
  onSelect,
  showInactive = false,
}: {
  config: MapConfigView;
  shapes: ShapeView[];
  locations: UbicacionView[];
  selectedId: string | null;
  matchIds: ReadonlySet<string>;
  onSelect: (id: string) => void;
  showInactive?: boolean;
}) {
  const base = useMemo(() => ({ x: -PAD, y: -PAD, w: config.width + PAD * 2, h: config.height + PAD * 2 }), [config.width, config.height]);
  const [zoom, setZoom] = useState({ scale: 1, cx: base.x + base.w / 2, cy: base.y + base.h / 2 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: false, startDist: 0, startScale: 1, total: 0 });

  const clamp = useCallback(
    (scale: number, cx: number, cy: number) => {
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
      const vw = base.w / s;
      const vh = base.h / s;
      return { scale: s, cx: Math.min(base.x + base.w - vw / 2, Math.max(base.x + vw / 2, cx)), cy: Math.min(base.y + base.h - vh / 2, Math.max(base.y + vh / 2, cy)) };
    },
    [base]
  );
  const zoomBy = (f: number) => setZoom((z) => clamp(z.scale * f, z.cx, z.cy));
  const fit = () => setZoom({ scale: 1, cx: base.x + base.w / 2, cy: base.y + base.h / 2 });

  // Al elegir una posición con zoom, se centra en ella.
  useEffect(() => {
    if (!selectedId) return;
    const l = locations.find((x) => x.id === selectedId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza el encuadre con la selección
    if (l) setZoom((z) => (z.scale > 1 ? clamp(z.scale, l.x + l.w / 2, l.y + l.h / 2) : z));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const vw = base.w / zoom.scale;
  const vh = base.h / zoom.scale;
  const viewBox = `${zoom.cx - vw / 2} ${zoom.cy - vh / 2} ${vw} ${vh}`;

  const unitsPerPx = () => {
    const el = wrapRef.current;
    if (!el) return 1;
    const r = el.getBoundingClientRect();
    return 1 / Math.min(r.width / vw, r.height / vh);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gesture.current.moved = false;
    gesture.current.total = 0;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.startDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      gesture.current.startScale = zoom.scale;
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (gesture.current.startDist > 0) {
        gesture.current.moved = true;
        setZoom((z) => clamp((gesture.current.startScale * d) / gesture.current.startDist, z.cx, z.cy));
      }
      return;
    }
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    gesture.current.total += Math.abs(dx) + Math.abs(dy);
    if (gesture.current.total > 8) gesture.current.moved = true;
    if (zoom.scale > 1 && gesture.current.moved) {
      const k = unitsPerPx();
      setZoom((z) => clamp(z.scale, z.cx - dx * k, z.cy - dy * k));
    }
  };
  const onPointerEnd = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
  };

  const sorted = [...shapes].filter((s) => s.active).sort((a, b) => a.sortOrder - b.sortOrder);
  const visible = locations.filter((l) => l.active || showInactive);
  const btn = "grid size-11 place-items-center rounded-lg border border-[var(--os-border)] bg-[var(--os-surface)] text-[var(--foreground)] shadow-sm hover:bg-[var(--os-bg)] disabled:opacity-40";

  return (
    <div data-testid="ubi-map-wrap">
      <div className="mb-2 flex items-center justify-end gap-1.5" data-testid="ubi-zoom-controls">
        <span className="mr-auto text-xs text-[var(--os-text-muted)]">{zoom.scale > 1 ? "Arrastrá para mover el plano" : "Acercá para ver mejor las posiciones"}</span>
        <button type="button" className={btn} onClick={() => zoomBy(1.4)} disabled={zoom.scale >= MAX_SCALE} aria-label="Acercar" data-testid="ubi-zoom-in"><Plus className="size-5" /></button>
        <button type="button" className={btn} onClick={() => zoomBy(1 / 1.4)} disabled={zoom.scale <= MIN_SCALE} aria-label="Alejar" data-testid="ubi-zoom-out"><Minus className="size-5" /></button>
        <button type="button" className={btn} onClick={fit} disabled={zoom.scale === 1} aria-label="Ajustar al plano" data-testid="ubi-zoom-fit"><Maximize2 className="size-5" /></button>
      </div>
      <div
        ref={wrapRef}
        className="mx-auto w-full select-none overflow-hidden rounded-xl border border-[var(--os-border)] bg-[var(--os-surface)]"
        style={{ aspectRatio: `${base.w} / ${base.h}`, maxHeight: "min(88vh, 980px)", touchAction: zoom.scale > 1 ? "none" : "pan-y", cursor: zoom.scale > 1 ? "grab" : "default" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={onPointerEnd}
        onWheel={(e) => {
          if (e.ctrlKey) zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
        }}
      >
        <svg viewBox={viewBox} width="100%" height="100%" role="group" aria-label={config.title} data-testid="ubi-map" data-scale={zoom.scale.toFixed(2)} preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
          {sorted.map((s) => <ShapeNode key={s.id} s={s} />)}
          {visible.map((l) => {
            const state = cellState(l, { selected: l.id === selectedId, match: matchIds.has(l.id) });
            const st = CELL_STYLE[state];
            const client = clientsLabel(l.items);
            const occupied = l.items.length > 0;
            const codeSize = Math.min(11.5, l.h * 0.3);
            const clientSize = Math.min(8.2, l.h * 0.23);
            const maxChars = Math.floor(l.w / (clientSize * 0.52));
            return (
              <g
                key={l.id}
                role="button"
                tabIndex={0}
                aria-label={`Ubicación ${l.code}, ${l.active ? (occupied ? `ocupada por ${client}` : "libre") : "inactiva"}${l.items.some((i) => !i.verified) ? ", con cantidades sin verificar" : ""}${matchIds.has(l.id) ? ", coincide con la búsqueda" : ""}`}
                aria-pressed={l.id === selectedId}
                data-testid={`ubi-cell-${l.code}`}
                data-state={state}
                data-code={l.code}
                style={{ cursor: "pointer", outline: "none" }}
                onClick={() => {
                  if (!gesture.current.moved) onSelect(l.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(l.id);
                  }
                }}
              >
                <title>{`${l.code}${occupied ? ` · ${l.items.map((i) => `${i.clientName}: ${i.material}${i.verified ? "" : " (sin verificar)"}`).join(" · ")}` : l.active ? " · Libre" : " · Inactiva"}`}</title>
                <rect x={l.x} y={l.y} width={l.w} height={l.h} rx={4} fill={st.fill} stroke={st.stroke} strokeWidth={state === "SELECCIONADA" ? 2.4 : state === "RESULTADO" ? 2 : 1.2} strokeDasharray={state === "INACTIVA" ? "3 2" : undefined} />
                <text x={l.x + l.w / 2} y={l.y + (occupied ? l.h * 0.43 : l.h / 2)} textAnchor="middle" dominantBaseline="middle" fontSize={codeSize} fontWeight={800} fill={st.text}>{l.code}</text>
                {l.active && l.items.some((i) => !i.verified) ? (
                  <g data-testid={`ubi-sv-${l.code}`}>
                    <circle cx={l.x + l.w - 4.5} cy={l.y + 4.5} r={3.8} fill="#f59e0b" stroke="#78350f" strokeWidth={0.7} />
                    <text x={l.x + l.w - 4.5} y={l.y + 4.7} textAnchor="middle" dominantBaseline="middle" fontSize={5.6} fontWeight={900} fill="#451a03">!</text>
                  </g>
                ) : null}
                {occupied ? <text x={l.x + l.w / 2} y={l.y + l.h * 0.76} textAnchor="middle" dominantBaseline="middle" fontSize={clientSize} fontWeight={600} fill={st.text}>{clip(client, maxChars)}</text> : null}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
