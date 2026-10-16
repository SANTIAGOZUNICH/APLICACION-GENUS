"use client";

import { useEffect, useRef, useState } from "react";

const STOPS = [12.5, 37.5, 62.5, 87.5];
const LABELS = ["Elaboración", "Envasado", "Listo para entregar", "Entregado"];

export function stopPosition(stageIndex: number, withinPct: number): number {
  const base = STOPS[Math.min(3, Math.max(0, stageIndex))]!;
  const within = stageIndex <= 1 ? Math.min(1, Math.max(0, withinPct / 100)) * 9 : 0;
  return base + within;
}

const ICONS: Record<number, string> = {
  // frasco de laboratorio
  0: "M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M8 15h8",
  // envase
  1: "M10 2.5h4V5l1.6 2.6V19a1.6 1.6 0 0 1-1.6 1.6h-4A1.6 1.6 0 0 1 8.4 19V7.6L10 5zM8.4 12h7.2",
  // cajas
  2: "M3.5 8.5 12 4l8.5 4.5v7L12 20l-8.5-4.5zM3.5 8.5 12 13l8.5-4.5M12 13v7",
  // llegada
  3: "M3 11 12 3l9 8M5.5 9.5V20h13V9.5M10 20v-5.5h4V20",
};

export function TruckSvg() {
  return (
    <svg viewBox="0 0 150 78" aria-hidden="true" focusable="false">
      <ellipse cx="76" cy="73" rx="66" ry="3.2" fill="#0b2f57" opacity=".12" />
      <rect x="2" y="6" width="94" height="52" rx="7" fill="#ffffff" stroke="#c9dcee" strokeWidth="1.5" />
      <image href="/entregas/logo-genus.png" x="8" y="9" width="82" height="43" preserveAspectRatio="xMidYMid meet" />
      <rect x="2" y="50" width="94" height="8" fill="#0b2f57" opacity=".9" rx="2" />
      <path d="M100 18h24c4 0 7 2 9 5l9 14c1.4 2 2 4 2 6.5V54a4 4 0 0 1-4 4H100z" fill="#0b2f57" />
      <path d="M106 24h15c2 0 3.5.8 4.6 2.4l6 9.1H106z" fill="#cfe9f8" />
      <rect x="143" y="44" width="5" height="5" rx="1.5" fill="#3fb8c9" />
      <rect x="100" y="50" width="48" height="3" fill="#3fb8c9" opacity=".9" />
      <g className="gp-wheel"><circle cx="30" cy="60" r="10" fill="#0b2f57" /><circle cx="30" cy="60" r="4.2" fill="#cfe9f8" /><path d="M30 55.5v9M25.5 60h9" stroke="#0b2f57" strokeWidth="1.4" /></g>
      <g className="gp-wheel"><circle cx="118" cy="60" r="10" fill="#0b2f57" /><circle cx="118" cy="60" r="4.2" fill="#cfe9f8" /><path d="M118 55.5v9M113.5 60h9" stroke="#0b2f57" strokeWidth="1.4" /></g>
    </svg>
  );
}

/** Camino de 4 etapas con el camión GENUS. Anima solo cuando la etapa cambia (y respeta «reducir movimiento» por CSS). */
export function TruckTracker({ productId, stageIndex, withinPct, labels = LABELS }: { productId: string; stageIndex: number; withinPct: number; labels?: string[] }) {
  const target = stopPosition(stageIndex, withinPct);
  const [left, setLeft] = useState(target);
  const [moving, setMoving] = useState(false);
  const [arrived, setArrived] = useState(false);
  const first = useRef(true);
  const prevTarget = useRef(target);

  useEffect(() => {
    const key = `gp-stage:${productId}`;
    let from = prevTarget.current;
    if (first.current) {
      first.current = false;
      try {
        const stored = sessionStorage.getItem(key);
        if (stored != null && Number.isFinite(Number(stored))) from = Number(stored);
      } catch {
        /* sin almacenamiento: sin animación inicial */
      }
    }
    try {
      sessionStorage.setItem(key, String(target));
    } catch {
      /* ignore */
    }
    prevTarget.current = target;
    if (Math.abs(from - target) < 0.5) {
      setLeft(target);
      return;
    }
    setLeft(from);
    setMoving(true);
    setArrived(false);
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setLeft(target)));
    const t = setTimeout(() => {
      setMoving(false);
      if (stageIndex === 3) setArrived(true);
    }, 1500);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [productId, target, stageIndex]);

  return (
    <div className="gp-road" role="img" aria-label={`Etapa actual: ${labels[stageIndex]}`} data-testid="truck-tracker" data-stage={stageIndex}>
      <div className="gp-road-line"><i style={{ width: `${left}%` }} /></div>
      <div className={`gp-truck${moving ? " is-moving" : ""}${arrived ? " is-arrived" : ""}`} style={{ left: `${left}%` }} data-testid="truck"><TruckSvg /></div>
      <div className="gp-stops">
        {labels.map((label, i) => (
          <div key={label} className={`gp-stop ${i < stageIndex || (stageIndex === 3 && i === 3) ? "done" : i === stageIndex ? "current" : ""}`} style={{ left: `${STOPS[i]}%` }}>
            <svg viewBox="0 0 24 24"><path d={ICONS[i]!} /></svg>
            <small>{label}</small>
          </div>
        ))}
      </div>
    </div>
  );
}
