"use client";

/**
 * Semanas para los sectores (Elaboración, Envasado Masivo/Premium, Codificado, Depósito, Materia Prima): la planificación
 * de Producción en SOLO LECTURA, con las MISMAS prioridades que fija Producción (no hay prioridades propias del sector).
 *  - «Semanas»: la semana organizada por días, con tarjetas.
 *  - «Día a día»: la jornada (hoy o el próximo día con tareas), ordenada por prioridad.
 *  - «Modo TV»: pantalla completa de la planificación del sector.
 * Ambas vistas salen de la misma respuesta del servidor (GET /api/v1/semanas/plan), que solo trae lo que el sector puede
 * ver. El trabajo operativo (avances, cantidades realizadas, observaciones, finalizar) sigue en «Mi trabajo».
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlanTaskCard, PriorityTag } from "@/features/os/operational/components/plan-task-card";
import { SemanasTvMode } from "@/features/os/operational/components/semanas-tv-mode";
import { useSectorPlan } from "@/features/os/operational/hooks/use-sector-plan";
import { usePreviewContext, usePreviewSession } from "@/features/os/session/preview-context";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import { byPriority, coversDay, formatDay, pickDays, PLAN_SECTOR_LABEL, plannedDays, viewablePlanSectors, weekStartOf, type PlanSector, type PlanTask } from "@/lib/semanas-sheet/plan-tasks";
import { PRIORITIES, PRIORITY_META, type Priority } from "@/lib/semanas-sheet/priorities";
import { SECTOR_LABELS, type SectorId } from "@/types/operational/sector";

type Mode = "semana" | "dia";
const MODE_KEY = "genus_os_semanas_sector_mode";
const DAY_SHORT = ["LUN", "MAR", "MIÉ", "JUE", "VIE"];

export function SemanasSectorView() {
  const workspace = useRequiredWorkspace();
  const { email, sectorId } = usePreviewSession();
  const { navigateSidebar } = usePreviewContext();
  const viewer = (sectorId ?? workspace.context.sectorId) as SectorId;
  const session = useMemo(() => ({ email: email ?? workspace.context.email, sector: viewer }), [email, viewer, workspace.context.email]);
  const allowed = viewablePlanSectors(viewer);
  const [sector, setSector] = useState<PlanSector | "ALL">(allowed.length === 1 ? allowed[0]! : "ALL");
  const [mode, setModeState] = useState<Mode>("semana");
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [dayIdx, setDayIdx] = useState<number | null>(null);
  const [tvOpen, setTvOpen] = useState(false);
  const plan = useSectorPlan(session, allowed.length > 0 ? sector : undefined);
  const data = plan.data;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(MODE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === "semana" || saved === "dia") setModeState(saved);
    } catch {
      /* sin almacenamiento: modo por defecto */
    }
  }, []);
  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      window.localStorage.setItem(MODE_KEY, m);
    } catch {
      /* no crítico */
    }
  };

  const today = data?.today ?? new Date().toISOString().slice(0, 10);
  // Semanas visibles: las plegadas en la Sheet original no se muestran (salvo en la copia de Preview, igual que Producción).
  const weeks = useMemo(() => {
    const showFolded = data?.source === "PREVIEW_XLSX";
    const byStart = new Map<string, { start: string; label: string; dates: (string | null)[] }>();
    for (const w of data?.weeks ?? []) {
      if (w.hidden && !showFolded) continue;
      const start = weekStartOf(w);
      if (!byStart.has(start)) byStart.set(start, { start, label: w.label, dates: w.dates });
    }
    return [...byStart.values()].sort((a, b) => a.start.localeCompare(b.start));
  }, [data]);
  const visibleTasks = useMemo(() => (data?.tasks ?? []).filter((t) => weeks.some((w) => w.start === t.weekStart)), [data, weeks]);
  const currentWeek = weeks.find((w) => (w.dates[4] ?? "") >= today) ?? weeks[weeks.length - 1];
  const week = weeks.find((w) => w.start === weekStart) ?? currentWeek;

  const days = useMemo(() => plannedDays(weeks.map((w) => ({ id: w.start, dates: w.dates })), visibleTasks), [weeks, visibleTasks]);
  const auto = useMemo(() => pickDays(days, today, 1), [days, today]);
  const dayPos = dayIdx ?? Math.max(0, days.findIndex((d) => d.date === auto.days[0]?.date));
  const day = days[dayPos];

  const multi = (data?.sectors.length ?? 0) > 1;
  const sectorTitle = sector === "ALL" ? (allowed.length === 3 ? "Todos los sectores" : allowed.map((s) => PLAN_SECTOR_LABEL[s]).join(" + ")) : PLAN_SECTOR_LABEL[sector];
  const openTv = useCallback(() => {
    setTvOpen(true);
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, []);
  const closeTv = useCallback(() => {
    setTvOpen(false);
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
  }, []);

  if (allowed.length === 0) {
    return (
      <TwinShell title="Semanas">
        <p className="rounded-xl border border-[var(--os-border)] bg-[var(--os-surface)] p-4 text-sm text-[var(--os-text-muted)]" data-testid="semanas-sector-noscope">
          {SECTOR_LABELS[viewer] ?? "Tu sector"} no tiene planificación en Semanas.
        </p>
      </TwinShell>
    );
  }

  return (
    <TwinShell title="Semanas">
      <div className="space-y-4" data-testid="semanas-sector">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl space-y-1">
            <h2 className="text-2xl font-semibold tracking-tight">Semanas · {sectorTitle}</h2>
            <p className="text-sm text-[var(--os-text-muted)]">
              Planificación de Producción (solo lectura). Las prioridades las asigna Producción y son las mismas en todas las pantallas.
              Para registrar avances, cantidades y observaciones usá{" "}
              <button type="button" className="font-semibold text-[var(--os-teal)] underline-offset-2 hover:underline" onClick={() => navigateSidebar("mi_trabajo")}>
                Mi trabajo
              </button>
              .
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--os-text-muted)]" role="status" data-testid="semanas-sector-updated">
            {plan.at ? `Actualizado ${plan.at.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}` : plan.loading ? "Cargando…" : ""}
            <Button type="button" variant="secondary" onClick={() => void plan.reload()} disabled={plan.loading} data-testid="semanas-sector-reload" aria-label="Actualizar">
              <RefreshCw className={`size-4 ${plan.loading ? "animate-spin" : ""}`} aria-hidden="true" />
            </Button>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-[var(--os-border)] bg-[var(--os-surface)] p-1" role="tablist" aria-label="Vista">
            {(["semana", "dia"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                data-testid={`semanas-sector-mode-${m}`}
                className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${mode === m ? "bg-[var(--os-teal)] text-[#04201e]" : "text-[var(--os-text-muted)] hover:text-[var(--os-text)]"}`}
              >
                {m === "semana" ? "Semanas" : "Día a día"}
              </button>
            ))}
          </div>
          {allowed.length > 1 && (
            <select
              value={sector}
              onChange={(e) => setSector(e.target.value as PlanSector | "ALL")}
              className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm"
              aria-label="Sector"
              data-testid="semanas-sector-select"
            >
              <option value="ALL">Todos ({allowed.map((s) => PLAN_SECTOR_LABEL[s]).join(", ")})</option>
              {allowed.map((s) => (
                <option key={s} value={s}>
                  {PLAN_SECTOR_LABEL[s]}
                </option>
              ))}
            </select>
          )}
          {mode === "semana" && weeks.length > 0 && (
            <select
              value={week?.start ?? ""}
              onChange={(e) => setWeekStart(e.target.value)}
              className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm"
              aria-label="Semana"
              data-testid="semanas-sector-week"
            >
              {weeks.map((w) => (
                <option key={w.start} value={w.start}>
                  {w.label}
                  {w.start === currentWeek?.start ? " (actual)" : ""}
                </option>
              ))}
            </select>
          )}
          {mode === "dia" && days.length > 0 && (
            <div className="inline-flex items-center gap-1">
              <Button type="button" variant="secondary" onClick={() => setDayIdx(Math.max(0, dayPos - 1))} disabled={dayPos <= 0} aria-label="Día anterior" data-testid="semanas-day-prev">
                <ChevronLeft className="size-4" aria-hidden="true" />
              </Button>
              <Button type="button" variant="secondary" onClick={() => setDayIdx(null)} data-testid="semanas-day-today">
                Hoy
              </Button>
              <Button type="button" variant="secondary" onClick={() => setDayIdx(Math.min(days.length - 1, dayPos + 1))} disabled={dayPos >= days.length - 1} aria-label="Día siguiente" data-testid="semanas-day-next">
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
          )}
          <Button type="button" variant="secondary" onClick={openTv} data-testid="semanas-tv-open" className="ml-auto">
            📺 Modo TV
          </Button>
        </div>

        {plan.error && (
          <p className="rounded-[var(--os-radius-sm)] border border-[var(--genus-error)]/40 bg-[var(--genus-error-soft)] px-3 py-2 text-sm text-[var(--genus-error)]" role="alert" data-testid="semanas-sector-error">
            {data ? `No se pudo actualizar (${plan.error}). Se muestran los datos de las ${plan.at?.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}.` : plan.error}
          </p>
        )}
        {data && !data.prioritiesAvailable && (
          <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100" role="status">
            Las prioridades todavía no están habilitadas en esta base: todas se muestran como NORMAL.
          </p>
        )}
        {data?.source === "PREVIEW_XLSX" && (
          <p className="rounded-lg border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-xs text-[var(--os-text-muted)]">
            Vista de prueba (Preview): datos de una copia XLSX de SEMANAS 2026, solo lectura.
          </p>
        )}

        {data && mode === "semana" && week && <WeekBoard tasks={visibleTasks.filter((t) => t.weekStart === week.start)} week={week} today={today} showSector={multi} />}
        {data && mode === "dia" && (
          <DayBoard
            tasks={day ? byPriority(visibleTasks.filter((t) => coversDay(t, day.weekStart, day.d))) : []}
            date={day?.date ?? null}
            isToday={day?.date === today}
            reason={dayIdx === null ? auto.reason : null}
            showSector={multi}
          />
        )}
        {data && visibleTasks.length === 0 && <p className="text-sm text-[var(--os-text-muted)]">Sin tareas planificadas para este sector.</p>}
      </div>
      {tvOpen && <SemanasTvMode session={session} sectors={allowed} initialSector={sector === "ALL" ? allowed[0] : sector} onExit={closeTv} />}
    </TwinShell>
  );
}

function PriorityCounts({ tasks }: { tasks: PlanTask[] }) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="semanas-priority-counts">
      {PRIORITIES.map((p) => (
        <span key={p} className="inline-flex items-center gap-1.5 text-sm text-[var(--os-text-muted)]">
          <PriorityTag priority={p} />
          <b className="tabular-nums text-[var(--os-text)]">{tasks.filter((t) => t.priority === p).length}</b>
        </span>
      ))}
    </div>
  );
}

function WeekBoard({ tasks, week, today, showSector }: { tasks: PlanTask[]; week: { start: string; label: string; dates: (string | null)[] }; today: string; showSector: boolean }) {
  return (
    <section className="space-y-3 rounded-2xl border border-[var(--os-border)] bg-[var(--os-bg)] p-3 sm:p-4" data-testid="semanas-week-board" aria-label={`Semana ${week.label}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--os-text-muted)]">Semana {week.label}</h3>
        <PriorityCounts tasks={tasks} />
      </div>
      <div className="grid gap-3 lg:grid-cols-5">
        {DAY_SHORT.map((label, d) => {
          const date = week.dates[d] ?? null;
          // Cada tarea aparece UNA vez: en su día de inicio (las de varios días muestran «Lun → Mié»).
          const list = byPriority(tasks.filter((t) => t.d === d));
          const isToday = date === today;
          return (
            <div key={label} className="min-w-0 space-y-2.5" data-testid={`week-day-${d}`} data-date={date ?? ""}>
              <div className={`flex items-baseline justify-between rounded-xl px-3 py-2 ${isToday ? "bg-[var(--os-teal)] text-[#04201e]" : "bg-[var(--os-surface)] text-[var(--os-text)]"}`}>
                <span className="text-xs font-bold tracking-[0.14em]">
                  {label}
                  {isToday ? " · HOY" : ""}
                </span>
                <span className="text-sm font-bold">{date ? formatDay(date).slice(4) : "—"}</span>
              </div>
              {list.map((t) => (
                <PlanTaskCard key={t.key} task={t} showDate={t.span > 1} showSector={showSector} />
              ))}
              {list.length === 0 && <p className="px-1 text-xs text-[var(--os-text-muted)]">Sin tareas.</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DayBoard({ tasks, date, isToday, reason, showSector }: { tasks: PlanTask[]; date: string | null; isToday: boolean; reason: string | null; showSector: boolean }) {
  const groups = PRIORITIES.map((p) => ({ p, list: tasks.filter((t) => t.priority === p) })).filter((g) => g.list.length > 0);
  return (
    <section className="space-y-4 rounded-2xl border border-[var(--os-border)] bg-[var(--os-bg)] p-3 sm:p-4" data-testid="semanas-day-board" data-date={date ?? ""}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--os-teal)]">{isToday ? "Hoy" : "Jornada"}</div>
          <h3 className="text-2xl font-bold tracking-tight">{formatDay(date, { long: true })}</h3>
          <p className="text-sm text-[var(--os-text-muted)]">
            {tasks.length} {tasks.length === 1 ? "tarea" : "tareas"}
            {tasks.some((t) => t.priority === "URGENTE") ? ` · ${tasks.filter((t) => t.priority === "URGENTE").length} urgente(s) primero` : ""}
          </p>
        </div>
        <PriorityCounts tasks={tasks} />
      </div>
      {reason && <p className="rounded-lg bg-white/5 px-3 py-1.5 text-sm text-[var(--os-text-muted)]" data-testid="semanas-day-reason">{reason}</p>}
      {groups.map(({ p, list }) => (
        <div key={p} className="space-y-2" data-testid={`day-group-${p}`}>
          <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[var(--os-text-muted)]">
            {PRIORITY_META[p as Priority].label} <span className="tabular-nums">({list.length})</span>
          </h4>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((t) => (
              <PlanTaskCard key={t.key} task={t} showDate={t.span > 1} showSector={showSector} />
            ))}
          </div>
        </div>
      ))}
      {tasks.length === 0 && <p className="text-sm text-[var(--os-text-muted)]">Sin tareas planificadas.</p>}
    </section>
  );
}
