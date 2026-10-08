"use client";

/**
 * Modo TV de Semanas: pantalla completa, solo lectura, letras grandes y alto contraste para televisores de planta.
 * Reutiliza la MISMA lectura (GET /api/v1/semanas/grid), el MISMO modelo de tareas y las MISMAS prioridades del
 * calendario operativo: no hay un sistema paralelo. Se actualiza solo (con datos seguros: si falla, conserva lo último
 * y lo avisa). No muestra estados inventados: solo lo que dice la planilla + la prioridad guardada en GENUS.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import { buildCalendarModel, type CalendarTask, type WeekModel } from "@/lib/semanas-sheet/calendar-tasks";
import { PRIORITY_META, priorityOf } from "@/lib/semanas-sheet/priorities";
import { fetchSemanasView, type SemanasViewResponse } from "@/lib/semanas-sheet/semanas-client";
import { SEMANAS_TABS, type SemanasTabKey } from "@/lib/semanas-sheet/semanas-tabs";
import { listPlannedDays, pickTvDays } from "@/lib/semanas-sheet/tv-days";
import { dayParts } from "./semanas-cards-view";
import { PRIORITY_STYLE, PriorityBadge } from "./semanas-priority-chip";

const TABS: SemanasTabKey[] = ["ELABORACION", "ACONDICIONAMIENTO"];
const DAY_NAMES = ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES"];
const REFRESH_MS = 60_000;
const ROTATE_MS = 40_000;

interface TabData {
  view: SemanasViewResponse | null;
  at: Date | null;
  error: string | null;
}

export function SemanasTvMode({ session, onExit, initialTab = "ELABORACION" }: { session: OrdersClientSession; onExit: () => void; initialTab?: SemanasTabKey }) {
  const [data, setData] = useState<Record<string, TabData>>({});
  const [tab, setTab] = useState<SemanasTabKey>(initialTab);
  const [rotate, setRotate] = useState(true);
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 1366 : window.innerWidth));
  const inflight = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      await Promise.all(
        TABS.map(async (key) => {
          try {
            const view = await fetchSemanasView(session, key);
            setData((prev) => ({ ...prev, [key]: { view, at: new Date(), error: null } }));
          } catch (e) {
            // Seguro: se conserva el último dato bueno y se avisa.
            setData((prev) => ({ ...prev, [key]: { view: prev[key]?.view ?? null, at: prev[key]?.at ?? null, error: e instanceof Error ? e.message : "Sin conexión" } }));
          }
        })
      );
    } finally {
      inflight.current = false;
    }
  }, [session]);

  useEffect(() => {
    // Carga inicial y actualización periódica (solo con la pestaña visible).
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!rotate) return;
    const t = setInterval(() => setTab((cur) => (cur === "ELABORACION" ? "ACONDICIONAMIENTO" : "ELABORACION")), ROTATE_MS);
    return () => clearInterval(t);
  }, [rotate]);

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

  const cur = data[tab];
  const view = cur?.view ?? null;
  const models = useMemo<WeekModel[]>(() => (view?.weeks ? buildCalendarModel(view.weeks, tab) : []), [view, tab]);
  const columns = width >= 1700 ? 3 : 2;
  const today = view?.today ?? new Date().toISOString().slice(0, 10);
  const pick = useMemo(() => (view?.weeks ? pickTvDays(listPlannedDays(view.weeks, models), today, columns) : { days: [], reason: null }), [view, models, today, columns]);
  const prios = view?.priorities?.byTask;

  // Si el contenido no entra en pantalla, se desplaza solo (en la TV nadie toca el mouse).
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
  }, [tab, pick.days.length]);

  // Portal a <body>: el Modo TV tapa TODO (sidebar, cabecera y botones flotantes) aunque un ancestro tenga transform/blur.
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHost(document.body);
  }, []);

  const staleErr = TABS.map((k) => data[k]?.error).find(Boolean);
  const at = cur?.at ?? null;

  if (!host) return null;
  return createPortal(
    <div className="fixed inset-0 z-[10000] flex flex-col bg-[#071a33] text-white" data-testid="semanas-tv" data-columns={columns} role="region" aria-label="Modo TV de Semanas">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-white/15 bg-[#0b2a52] px-[2vw] py-[1.2vh]">
        <div className="flex items-baseline gap-4">
          <span className="whitespace-nowrap text-[clamp(1.1rem,1.9vw,2.2rem)] font-extrabold tracking-wide">GENUS OS</span>
          <span className="whitespace-nowrap text-[clamp(1rem,1.6vw,1.9rem)] font-semibold text-teal-300">{SEMANAS_TABS[tab].label}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 whitespace-nowrap text-[clamp(0.75rem,1vw,1.15rem)]">
          <div className="flex overflow-hidden rounded-full border border-white/25" role="tablist">
            {TABS.map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setRotate(false); }} className={`px-3 py-1.5 font-bold ${tab === k ? "bg-teal-400 text-[#04201e]" : "text-white/80 hover:bg-white/10"}`} data-testid={`tv-tab-${k}`}>
                {SEMANAS_TABS[k].label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setRotate((r) => !r)} className="rounded-full border border-white/25 px-3 py-1.5 text-white/80 hover:bg-white/10" data-testid="tv-rotate">
            {rotate ? "⏸ Pausar rotación" : "▶ Rotar pantallas"}
          </button>
          <span className="text-white/80" data-testid="tv-updated" role="status">
            {at ? `Actualizado ${at.toLocaleTimeString("es-AR")}` : "Cargando…"}
          </span>
          <button type="button" onClick={onExit} className="rounded-full border border-white/25 px-3 py-1.5 text-white/70 hover:bg-white/10" data-testid="tv-exit">
            Salir (Esc)
          </button>
        </div>
      </header>

      {staleErr && (
        <div className="bg-amber-500/20 px-[2vw] py-1 text-[clamp(0.8rem,1.1vw,1.2rem)] text-amber-100" role="alert" data-testid="tv-stale">
          Sin conexión con la planilla ({staleErr}). Se muestran los últimos datos recibidos{at ? ` a las ${at.toLocaleTimeString("es-AR")}` : ""}.
        </div>
      )}
      {pick.reason && (
        <div className="bg-white/10 px-[2vw] py-1 text-[clamp(0.8rem,1.1vw,1.2rem)] text-white/85" data-testid="tv-reason">
          {pick.reason}
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-hidden px-[2vw] py-[1.5vh]" data-testid="tv-scroll">
        {!view && !staleErr && <p className="text-[clamp(1.2rem,2vw,2.2rem)] text-white/70">Cargando la planificación…</p>}
        {view && pick.days.length === 0 && <p className="text-[clamp(1.2rem,2vw,2.2rem)] text-white/70">La planilla no tiene tareas cargadas.</p>}
        <div className="grid gap-[1.4vw]" style={{ gridTemplateColumns: `repeat(${Math.max(1, pick.days.length)}, minmax(0, 1fr))` }}>
          {pick.days.map((day) => {
            const model = models.find((m) => m.weekId === day.weekId);
            const parts = dayParts(day.date);
            const isToday = day.date === today;
            const sections = (model?.sections ?? [])
              .map((s) => ({ s, tasks: s.tasks.filter((t) => t.d === day.d || (t.d < day.d && t.d + t.span - 1 >= day.d)) }))
              .filter((x) => x.tasks.length > 0);
            return (
              <section key={day.date} data-testid="tv-day" data-date={day.date} className="min-w-0 space-y-[1.2vh]">
                <div className={`rounded-2xl px-[1.2vw] py-[1vh] text-center ${isToday ? "bg-teal-400 text-[#04201e]" : "bg-[#123a6b] text-white"}`}>
                  <div className="text-[clamp(1rem,1.6vw,1.8rem)] font-extrabold tracking-[0.16em]">{DAY_NAMES[day.d]}{isToday ? " · HOY" : ""}</div>
                  <div className="text-[clamp(1.8rem,3.4vw,3.8rem)] font-black leading-none">{parts?.dd} <span className="text-[0.55em] font-bold opacity-80">{parts?.mon}</span></div>
                </div>
                {sections.map(({ s, tasks }) => (
                  <div key={s.index} className="space-y-[1vh]">
                    {s.title && <div className="text-[clamp(0.9rem,1.35vw,1.5rem)] font-bold uppercase tracking-[0.12em] text-teal-300">{s.title.value}</div>}
                    {[...tasks].sort((a, b) => PRIORITY_META[priorityOf(prios, a.key)].rank - PRIORITY_META[priorityOf(prios, b.key)].rank).map((t) => (
                      <TvCard key={t.key} task={t} priority={priorityOf(prios, t.key)} />
                    ))}
                  </div>
                ))}
                {sections.length === 0 && <p className="text-[clamp(1rem,1.5vw,1.7rem)] text-white/60">Sin tareas cargadas para este día.</p>}
              </section>
            );
          })}
        </div>
      </div>
    </div>,
    host
  );
}

function TvCard({ task, priority }: { task: CalendarTask; priority: "URGENTE" | "IMPORTANTE" | "NORMAL" }) {
  const st = PRIORITY_STYLE[priority];
  return (
    <article data-testid="tv-card" data-priority={priority} className="rounded-2xl bg-[#0e2f5a] p-[1.1vw]" style={{ borderLeft: `0.9vw solid ${st.accent}`, background: priority === "URGENTE" ? `linear-gradient(90deg, ${st.soft}, transparent 60%), #0e2f5a` : undefined }}>
      <div className="mb-[0.6vh] flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {task.lines.filter((l) => l.role === "client").map((l) => (
            <div key={l.a1} className="text-[clamp(0.9rem,1.3vw,1.5rem)] font-bold uppercase tracking-[0.08em] text-white/70">{l.value}</div>
          ))}
        </div>
        <PriorityBadge priority={priority} size="lg" />
      </div>
      {task.lines.filter((l) => l.role !== "client").map((l) =>
        l.role === "quantity" ? (
          <div key={l.a1} className="text-[clamp(1.3rem,2.2vw,2.6rem)] font-black tabular-nums text-teal-300">{l.value}</div>
        ) : l.role === "note" ? (
          <div key={l.a1} className="mt-1 w-fit rounded-lg bg-amber-400/20 px-3 text-[clamp(0.9rem,1.4vw,1.6rem)] font-bold text-amber-200">{l.value}</div>
        ) : (
          <div key={l.a1} className="text-[clamp(1.4rem,2.4vw,2.9rem)] font-black leading-tight text-white">{l.value}</div>
        )
      )}
    </article>
  );
}
