"use client";

/**
 * Modo TV de Semanas: pantalla completa, sin sidebar, SOLO LECTURA, para televisores de planta (1280×720, 1366×768,
 * 1920×1080). Disponible para Producción (elige sector o rota entre todos) y para cada sector (solo lo suyo: el servidor
 * — GET /api/v1/semanas/plan — decide qué puede ver cada usuario). Usa la MISMA proyección y las MISMAS prioridades que
 * Semanas y Día a día. Se actualiza solo; si una lectura falla conserva lo último y lo avisa. Nada se inventa.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import { byPriority, coversDay, formatDay, pickDays, PLAN_SECTOR_LABEL, plannedDays, type PlanSector } from "@/lib/semanas-sheet/plan-tasks";
import { PRIORITIES } from "@/lib/semanas-sheet/priorities";
import { fetchSectorPlan, type SectorPlanResponse } from "@/lib/semanas-sheet/semanas-client";
import { PlanTaskCard, PriorityTag } from "./plan-task-card";

const REFRESH_MS = 60_000;
const ROTATE_MS = 40_000;

interface SectorData {
  plan: SectorPlanResponse | null;
  at: Date | null;
  error: string | null;
}

/** Días por pantalla según el ancho: más columnas en pantallas grandes, sin achicar la letra por debajo de lo legible. */
export function tvColumns(width: number): number {
  return width >= 1800 ? 4 : width >= 1200 ? 3 : 2;
}

export interface SemanasTvModeProps {
  session: OrdersClientSession;
  /** Sectores que se pueden mostrar (los permitidos al usuario). */
  sectors: PlanSector[];
  initialSector?: PlanSector;
  onExit: () => void;
}

export function SemanasTvMode({ session, sectors, initialSector, onExit }: SemanasTvModeProps) {
  const [data, setData] = useState<Partial<Record<PlanSector, SectorData>>>({});
  const [sector, setSector] = useState<PlanSector>(initialSector && sectors.includes(initialSector) ? initialSector : sectors[0]!);
  const [rotate, setRotate] = useState(sectors.length > 1);
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 1366 : window.innerWidth));
  const inflight = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      await Promise.all(
        sectors.map(async (s) => {
          try {
            const plan = await fetchSectorPlan(session, s);
            setData((prev) => ({ ...prev, [s]: { plan, at: new Date(), error: null } }));
          } catch (e) {
            // Seguro: se conserva el último dato bueno y se avisa.
            setData((prev) => ({ ...prev, [s]: { plan: prev[s]?.plan ?? null, at: prev[s]?.at ?? null, error: e instanceof Error ? e.message : "Sin conexión" } }));
          }
        })
      );
    } finally {
      inflight.current = false;
    }
  }, [session, sectors]);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!rotate || sectors.length < 2) return;
    const t = setInterval(() => setSector((cur) => sectors[(sectors.indexOf(cur) + 1) % sectors.length]!), ROTATE_MS);
    return () => clearInterval(t);
  }, [rotate, sectors]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onExit();
    };
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [onExit]);

  const cur = data[sector];
  const plan = cur?.plan ?? null;
  const columns = tvColumns(width);
  const today = plan?.today ?? new Date().toISOString().slice(0, 10);
  const pick = useMemo(() => {
    if (!plan) return { days: [], reason: null };
    const weeks = plan.weeks.filter((w) => !w.hidden || plan.source === "PREVIEW_XLSX");
    return pickDays(plannedDays(weeks, plan.tasks), today, columns);
  }, [plan, today, columns]);

  // Si el contenido no entra, se desplaza solo (en la TV nadie toca el mouse).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
    const t = setInterval(() => {
      if (el.scrollHeight <= el.clientHeight + 4) return;
      const next = el.scrollTop + el.clientHeight * 0.85;
      el.scrollTo({ top: next >= el.scrollHeight - el.clientHeight ? 0 : next, behavior: "smooth" });
    }, 9000);
    return () => clearInterval(t);
  }, [sector, pick.days.length]);

  // Portal a <body>: el Modo TV tapa TODO (sidebar, cabecera y botones flotantes).
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHost(document.body);
  }, []);

  const err = cur?.error ?? null;
  const at = cur?.at ?? null;
  const hhmm = (d: Date) => d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

  if (!host) return null;
  return createPortal(
    <div className="fixed inset-0 z-[10000] flex flex-col bg-[#071a33] text-white" data-testid="semanas-tv" data-columns={columns} data-sector={sector} role="region" aria-label="Modo TV de Semanas">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-white/10 bg-[#0b2a52] px-[1.6vw] py-[0.9vh]">
        <div className="flex items-baseline gap-3">
          <span className="whitespace-nowrap text-[clamp(1rem,1.35vw,1.6rem)] font-extrabold tracking-wide">GENUS OS</span>
          <span className="whitespace-nowrap text-[clamp(0.95rem,1.25vw,1.5rem)] font-semibold text-teal-300" data-testid="tv-title">
            Semanas · {PLAN_SECTOR_LABEL[sector]}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 whitespace-nowrap text-[clamp(0.7rem,0.85vw,1rem)]">
          {sectors.length > 1 && (
            <div className="flex overflow-hidden rounded-full border border-white/20" role="tablist">
              {sectors.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={sector === s}
                  onClick={() => {
                    setSector(s);
                    setRotate(false);
                  }}
                  className={`px-3 py-1 font-bold ${sector === s ? "bg-teal-400 text-[#04201e]" : "text-white/80 hover:bg-white/10"}`}
                  data-testid={`tv-tab-${s}`}
                >
                  {PLAN_SECTOR_LABEL[s]}
                </button>
              ))}
            </div>
          )}
          {sectors.length > 1 && (
            <button type="button" onClick={() => setRotate((r) => !r)} className="rounded-full border border-white/20 px-3 py-1 text-white/80 hover:bg-white/10" data-testid="tv-rotate">
              {rotate ? "⏸ Pausar rotación" : "▶ Rotar sectores"}
            </button>
          )}
          <span className="flex items-center gap-1.5 text-white/85" data-testid="tv-updated" role="status">
            <span className={`inline-block size-2 rounded-full ${err ? "bg-amber-400" : at ? "bg-emerald-400" : "bg-white/40"}`} aria-hidden="true" />
            {at ? `Actualizado ${hhmm(at)}` : err ? "Sin datos" : "Cargando…"}
          </span>
          <button type="button" onClick={onExit} className="rounded-full border border-white/20 px-3 py-1 text-white/70 hover:bg-white/10" data-testid="tv-exit">
            Salir (Esc)
          </button>
        </div>
      </header>

      {err && (
        <div className="bg-amber-500/20 px-[1.6vw] py-1 text-[clamp(0.75rem,0.9vw,1.05rem)] text-amber-100" role="alert" data-testid="tv-stale">
          No se pudo actualizar la planificación: {err}{at ? ` Se muestran los últimos datos recibidos a las ${hhmm(at)}.` : ""} Se reintenta automáticamente cada minuto.
        </div>
      )}
      {pick.reason && (
        <div className="bg-white/10 px-[1.6vw] py-1 text-[clamp(0.75rem,0.9vw,1.05rem)] text-white/85" data-testid="tv-reason">
          {pick.reason}
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-hidden px-[1.6vw] py-[1.2vh]" data-testid="tv-scroll">
        {!plan && !err && <p className="text-[clamp(1rem,1.4vw,1.7rem)] text-white/70">Cargando la planificación…</p>}
        {plan && pick.days.length === 0 && <p className="text-[clamp(1rem,1.4vw,1.7rem)] text-white/70">No hay tareas planificadas para {PLAN_SECTOR_LABEL[sector]}.</p>}
        {/* Ancho de columna constante: si hay menos días que columnas, cada día usa varias columnas de tarjetas. */}
        <div className="grid gap-[1vw]" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {pick.days.map((day, i) => {
            const per = Math.floor(columns / Math.max(1, pick.days.length));
            const spanCols = per + (i < columns - per * pick.days.length ? 1 : 0);
            const tasks = byPriority((plan?.tasks ?? []).filter((t) => coversDay(t, day.weekStart, day.d)));
            const isToday = day.date === today;
            return (
              <section key={day.date} data-testid="tv-day" data-date={day.date} className="min-w-0 space-y-[0.9vh]" style={{ gridColumn: `span ${spanCols}` }}>
                <div className={`flex items-center justify-between rounded-xl px-[0.9vw] py-[0.7vh] ${isToday ? "bg-teal-400 text-[#04201e]" : "bg-[#123a6b] text-white"}`}>
                  <span className="text-[clamp(0.95rem,1.2vw,1.5rem)] font-extrabold uppercase tracking-[0.1em]">
                    {formatDay(day.date, { long: true })}
                    {isToday ? " · HOY" : ""}
                  </span>
                  <span className="flex items-center gap-1.5">
                    {PRIORITIES.filter((p) => p !== "NORMAL").map((p) => {
                      const n = tasks.filter((t) => t.priority === p).length;
                      return n > 0 ? (
                        <span key={p} className="flex items-center gap-1">
                          <PriorityTag priority={p} size="tv" />
                          <b className="tabular-nums">{n}</b>
                        </span>
                      ) : null;
                    })}
                    <span className="text-[clamp(0.75rem,0.9vw,1.05rem)] font-semibold opacity-80">{tasks.length} tareas</span>
                  </span>
                </div>
                <div className="grid gap-[0.9vh_1vw]" style={{ gridTemplateColumns: `repeat(${spanCols}, minmax(0, 1fr))` }}>
                  {tasks.map((t) => (
                    <PlanTaskCard key={t.key} task={t} size="tv" showDate={t.span > 1} />
                  ))}
                </div>
                {tasks.length === 0 && <p className="text-[clamp(0.9rem,1.1vw,1.3rem)] text-white/60">Sin tareas para este día.</p>}
              </section>
            );
          })}
        </div>
      </div>
    </div>,
    host
  );
}
