"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

/** Los 6 estados comerciales (cortos para que entren en el celular; el nombre completo va en el aria-label y en la etiqueta del estado). */
const LABELS = ["Recibido", "Programado", "Elaboración", "Envasado", "Listo", "Entregado"];
const FULL_LABELS = ["Pedido recibido", "Pedido programado", "En elaboración", "En envasado", "Listo para entregar", "Entregado"];
const N = LABELS.length;
const STOPS = LABELS.map((_, i) => ((i + 0.5) * 100) / N);

export function stopPosition(stageIndex: number, withinPct: number): number {
  const i = Math.min(N - 1, Math.max(0, stageIndex));
  // Dentro de Elaboración y Envasado el camión avanza hacia la parada siguiente según el plazo estimado.
  const within = i === 2 || i === 3 ? Math.min(1, Math.max(0, withinPct / 100)) * (100 / N) * 0.55 : 0;
  return STOPS[i]! + within;
}

export const ICONS: Record<number, string> = {
  // pedido recibido (documento con tilde)
  0: "M7 3h7l4 4v14H7zM14 3v4h4M9.5 14l2 2 3.5-4",
  // programado (calendario)
  1: "M4.5 6.5h15V20h-15zM4.5 10.5h15M8.5 4v4M15.5 4v4",
  // frasco de laboratorio
  2: "M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M8 15h8",
  // envase
  3: "M10 2.5h4V5l1.6 2.6V19a1.6 1.6 0 0 1-1.6 1.6h-4A1.6 1.6 0 0 1 8.4 19V7.6L10 5zM8.4 12h7.2",
  // cajas
  4: "M3.5 8.5 12 4l8.5 4.5v7L12 20l-8.5-4.5zM3.5 8.5 12 13l8.5-4.5M12 13v7",
  // llegada
  5: "M3 11 12 3l9 8M5.5 9.5V20h13V9.5M10 20v-5.5h4V20",
};

export function TruckSvg() {
  return (
    <svg viewBox="0 0 150 78" aria-hidden="true" focusable="false">
      <ellipse cx="76" cy="73" rx="66" ry="3.2" fill="#0b2f57" opacity=".12" />
      <g className="gp-body">
        <rect x="2" y="6" width="94" height="52" rx="7" fill="#ffffff" stroke="#c9dcee" strokeWidth="1.5" />
        <image href="/entregas/logo-genus.png" x="8" y="9" width="82" height="43" preserveAspectRatio="xMidYMid meet" />
        <rect x="2" y="50" width="94" height="8" fill="#0b2f57" opacity=".9" rx="2" />
        <path d="M100 18h24c4 0 7 2 9 5l9 14c1.4 2 2 4 2 6.5V54a4 4 0 0 1-4 4H100z" fill="#0b2f57" />
        <path d="M106 24h15c2 0 3.5.8 4.6 2.4l6 9.1H106z" fill="#cfe9f8" />
        <rect x="143" y="44" width="5" height="5" rx="1.5" fill="#3fb8c9" />
        <rect x="100" y="50" width="48" height="3" fill="#3fb8c9" opacity=".9" />
      </g>
      <g className="gp-wheel"><circle cx="30" cy="60" r="10" fill="#0b2f57" /><circle cx="30" cy="60" r="4.2" fill="#cfe9f8" /><path d="M30 55.5v9M25.5 60h9" stroke="#0b2f57" strokeWidth="1.4" /></g>
      <g className="gp-wheel"><circle cx="118" cy="60" r="10" fill="#0b2f57" /><circle cx="118" cy="60" r="4.2" fill="#cfe9f8" /><path d="M118 55.5v9M113.5 60h9" stroke="#0b2f57" strokeWidth="1.4" /></g>
    </svg>
  );
}

const CONFETTI_COLORS = ["#61C2D0", "#0064AE", "#3fb8c9", "#ffffff", "#0A3556", "#8fd8e2"];
const CONFETTI_PIECES = Array.from({ length: 26 }, (_, i) => {
  const r = (n: number) => { const x = Math.sin((i + 1) * 12.9898 + n * 78.233) * 43758.5453; return x - Math.floor(x); };
  return { dx: Math.round((r(1) - 0.5) * 190), up: Math.round(40 + r(2) * 60), down: Math.round(10 + r(3) * 40), rot: Math.round((r(4) - 0.5) * 720), delay: Math.round(r(5) * 160), color: CONFETTI_COLORS[i % CONFETTI_COLORS.length]!, round: i % 3 === 0 };
});

function celebratedKey(productId: string) {
  return `gp-celebrated:${productId}`;
}
function wasCelebrated(productId: string): boolean {
  try {
    return localStorage.getItem(celebratedKey(productId)) != null;
  } catch {
    return true; // sin almacenamiento no se puede garantizar «no repetir»: no se celebra
  }
}
function markCelebrated(productId: string) {
  try {
    localStorage.setItem(celebratedKey(productId), String(Date.now()));
  } catch {
    /* ignore */
  }
}

function usePageHidden(): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return hidden;
}

/** Camino de 6 estados comerciales con el camión GENUS. Solo se anima con transform/opacity; respeta «reducir movimiento» por CSS y se pausa con la pestaña oculta. */
export function TruckTracker({ productId, stageIndex, withinPct, labels = LABELS }: { productId: string; stageIndex: number; withinPct: number; labels?: string[] }) {
  const last = labels.length - 1;
  const readyIdx = last - 1;
  const target = stopPosition(stageIndex, withinPct);
  const [left, setLeft] = useState(target);
  const [go, setGo] = useState(false); // la transición solo está activa mientras el camión viaja a la nueva etapa
  const [moving, setMoving] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [burst, setBurst] = useState(0);
  const first = useRef(true);
  const prevTarget = useRef(target);
  const hidden = usePageHidden();

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
      setGo(false);
      setLeft(target);
      return;
    }
    // «Listo para entregar» observado EN VIVO (venía de una etapa anterior en esta sesión): única condición para celebrar.
    const observedReady = stageIndex === readyIdx && from < STOPS[readyIdx]! - 0.5;
    setGo(false);
    setLeft(from);
    setMoving(true);
    setArrived(false);
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => { setGo(true); setLeft(target); }));
    const t = setTimeout(() => {
      setMoving(false);
      if (stageIndex >= readyIdx) setArrived(true);
      if (observedReady && !wasCelebrated(productId)) {
        markCelebrated(productId);
        let reduced = false;
        try {
          reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        } catch {
          /* ignore */
        }
        if (!reduced && !document.hidden) {
          setBurst((n) => n + 1);
          setTimeout(() => setBurst(0), 2800);
        }
      }
    }, 1500);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [productId, target, stageIndex, last, readyIdx]);

  const running = stageIndex === 2 || stageIndex === 3 || moving;
  return (
    <div className={`gp-road${hidden ? " is-paused" : ""}`} role="img" aria-label={`Estado actual: ${FULL_LABELS[stageIndex] ?? labels[stageIndex]}`} data-testid="truck-tracker" data-stage={stageIndex}>
      <div className="gp-road-in">
      <div className="gp-road-line"><i className={go ? "is-go" : ""} style={{ transform: `scaleX(${left / 100})` }} /></div>
      <div className={`gp-truck-track${go ? " is-go" : ""}`} style={{ transform: `translateX(${left}%)` }}>
        <div className={`gp-truck${running ? " is-running" : ""}${moving ? " is-moving" : ""}${arrived ? " is-arrived" : ""}`} data-pos={target} data-testid="truck">
          <span className="gp-speed" aria-hidden="true"><i /><i /><i /></span>
          <TruckSvg />
        </div>
        {burst ? (
          <div className="gp-confetti" key={burst} aria-hidden="true" data-testid="confetti">
            {CONFETTI_PIECES.map((c, i) => (
              <i key={i} className={c.round ? "r" : ""} style={{ "--dx": `${c.dx}px`, "--up": `-${c.up}px`, "--down": `${c.down}px`, "--rot": `${c.rot}deg`, "--c": c.color, animationDelay: `${c.delay}ms` } as CSSProperties} />
            ))}
          </div>
        ) : null}
      </div>
      <div className="gp-stops">
        {labels.map((label, i) => (
          <div key={label} className={`gp-stop ${i < stageIndex || (stageIndex === last && i === last) ? "done" : i === stageIndex ? "current" : ""}${i === stageIndex ? " is-now" : ""}`} style={{ left: `${STOPS[i]}%`, width: `${100 / N}%` }}>
            <svg viewBox="0 0 24 24"><path d={ICONS[i]!} /></svg>
            <small>{label}</small>
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
