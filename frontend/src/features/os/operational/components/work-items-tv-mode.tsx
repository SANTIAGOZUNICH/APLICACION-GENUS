"use client";

/**
 * Modo TV de un SECTOR: sus propias tareas (WorkItems), hoy y el siguiente día con planificación, solo lectura, letras
 * grandes y la prioridad que asignó Producción (compartida). Misma lectura que la planificación del sector
 * (`/api/v1/work-items`, que ya agrega la prioridad): no hay una fuente paralela. No muestra datos ni estados inventados.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchWorkItems } from "@/lib/api/operations-client";
import { PRIORITY_META, type Priority } from "@/lib/semanas-sheet/priorities";
import { pickTvDays } from "@/lib/semanas-sheet/tv-days";
import type { SectorId } from "@/types/operational/sector";
import type { WorkItem } from "@/types/operational/work-item";
import { PRIORITY_STYLE, PriorityBadge } from "./semanas-priority-chip";

const REFRESH_MS = 60_000;
const DAY_NAMES = ["DOMINGO", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const localIso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const prio = (w: WorkItem): Priority => w.genusPriority?.priority ?? "NORMAL";

export function WorkItemsTvMode({ sector, sectorLabel, onExit }: { sector: SectorId; sectorLabel: string; onExit: () => void }) {
  const [items, setItems] = useState<WorkItem[] | null>(null);
  const [at, setAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 1366 : window.innerWidth));
  const [host, setHost] = useState<HTMLElement | null>(null);
  const inflight = useRef(false);

  const load = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const res = await fetchWorkItems(sector, {});
      setItems(res.workItems);
      setAt(new Date());
      setError(null);
    } catch (e) {
      // Seguro: se conserva el último dato bueno y se avisa.
      setError(e instanceof Error ? e.message : "Sin conexión");
    } finally {
      inflight.current = false;
    }
  }, [sector]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHost(document.body);
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

  const columns = width >= 1700 ? 3 : 2;
  const today = localIso();
  const byDate = useMemo(() => {
    const m = new Map<string, WorkItem[]>();
    for (const w of items ?? []) if (w.plannedDate) m.set(w.plannedDate, [...(m.get(w.plannedDate) ?? []), w]);
    return m;
  }, [items]);
  const pick = useMemo(() => pickTvDays([...byDate.keys()].sort().map((date) => ({ date, weekId: "", d: 0 })), today, columns), [byDate, today, columns]);

  if (!host) return null;
  return createPortal(
    <div className="fixed inset-0 z-[10000] flex flex-col bg-[#071a33] text-white" data-testid="sector-tv" data-columns={columns} role="region" aria-label={`Modo TV · ${sectorLabel}`}>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-white/15 bg-[#0b2a52] px-[2vw] py-[1.2vh]">
        <div className="flex items-baseline gap-4">
          <span className="whitespace-nowrap text-[clamp(1.1rem,1.9vw,2.2rem)] font-extrabold tracking-wide">GENUS OS</span>
          <span className="whitespace-nowrap text-[clamp(1rem,1.6vw,1.9rem)] font-semibold text-teal-300">{sectorLabel}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 whitespace-nowrap text-[clamp(0.75rem,1vw,1.15rem)]">
          <span className="text-white/80" role="status" data-testid="tv-updated">{at ? `Actualizado ${at.toLocaleTimeString("es-AR")}` : "Cargando…"}</span>
          <button type="button" onClick={onExit} className="rounded-full border border-white/25 px-3 py-1.5 text-white/70 hover:bg-white/10" data-testid="tv-exit">Salir (Esc)</button>
        </div>
      </header>
      {error && (
        <div className="bg-amber-500/20 px-[2vw] py-1 text-[clamp(0.8rem,1.1vw,1.2rem)] text-amber-100" role="alert" data-testid="tv-stale">
          Sin conexión ({error}). Se muestran los últimos datos recibidos{at ? ` a las ${at.toLocaleTimeString("es-AR")}` : ""}.
        </div>
      )}
      {pick.reason && <div className="bg-white/10 px-[2vw] py-1 text-[clamp(0.8rem,1.1vw,1.2rem)] text-white/85" data-testid="tv-reason">{pick.reason}</div>}
      <div className="min-h-0 flex-1 overflow-hidden px-[2vw] py-[1.5vh]">
        {!items && !error && <p className="text-[clamp(1.2rem,2vw,2.2rem)] text-white/70">Cargando tus tareas…</p>}
        {items && pick.days.length === 0 && <p className="text-[clamp(1.2rem,2vw,2.2rem)] text-white/70">No hay tareas planificadas para tu sector.</p>}
        <div className="grid gap-[1.4vw]" style={{ gridTemplateColumns: `repeat(${Math.max(1, pick.days.length)}, minmax(0, 1fr))` }}>
          {pick.days.map((day) => {
            const dt = new Date(`${day.date}T12:00:00`);
            const list = [...(byDate.get(day.date) ?? [])].sort((a, b) => PRIORITY_META[prio(a)].rank - PRIORITY_META[prio(b)].rank);
            return (
              <section key={day.date} data-testid="tv-day" data-date={day.date} className="min-w-0 space-y-[1.2vh]">
                <div className={`rounded-2xl px-[1.2vw] py-[1vh] text-center ${day.date === today ? "bg-teal-400 text-[#04201e]" : "bg-[#123a6b] text-white"}`}>
                  <div className="text-[clamp(1rem,1.6vw,1.8rem)] font-extrabold tracking-[0.16em]">{DAY_NAMES[dt.getDay()]}{day.date === today ? " · HOY" : ""}</div>
                  <div className="text-[clamp(1.8rem,3.4vw,3.8rem)] font-black leading-none">{dt.getDate()} <span className="text-[0.55em] font-bold opacity-80">{MONTHS[dt.getMonth()]}</span></div>
                </div>
                {list.map((w) => {
                  const st = PRIORITY_STYLE[prio(w)];
                  return (
                    <article key={w.id} data-testid="tv-card" data-priority={prio(w)} className="rounded-2xl bg-[#0e2f5a] p-[1.1vw]" style={{ borderLeft: `0.9vw solid ${st.accent}` }}>
                      <div className="mb-[0.6vh] flex items-start justify-between gap-3">
                        <div className="text-[clamp(0.9rem,1.3vw,1.5rem)] font-bold uppercase tracking-[0.08em] text-white/70">{w.client ?? ""}</div>
                        <PriorityBadge priority={prio(w)} size="lg" />
                      </div>
                      <div className="text-[clamp(1.4rem,2.4vw,2.9rem)] font-black leading-tight text-white">{w.product ?? "—"}</div>
                      {w.quantity && <div className="text-[clamp(1.3rem,2.2vw,2.6rem)] font-black tabular-nums text-teal-300">{w.quantity} {w.unit ?? ""}</div>}
                      {(w.line || w.ownerPerson) && <div className="mt-1 text-[clamp(0.9rem,1.3vw,1.5rem)] text-white/70">{[w.line, w.ownerPerson].filter(Boolean).join(" · ")}</div>}
                    </article>
                  );
                })}
                {list.length === 0 && <p className="text-[clamp(1rem,1.5vw,1.7rem)] text-white/60">Sin tareas para este día.</p>}
              </section>
            );
          })}
        </div>
      </div>
    </div>,
    host
  );
}
