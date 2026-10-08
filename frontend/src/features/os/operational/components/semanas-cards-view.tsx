"use client";

/**
 * Calendario operativo de Semanas: la planificación de la semana (lun–vie) como tarjetas legibles, agrupada por responsable.
 * Usa el MISMO motor de edición que la Planilla (useCalendarEngine): cada línea de una tarjeta es una celda de la Sheet
 * (A1) y se edita en el lugar (Enter / Esc / Tab, selección de rangos, copiar y pegar con vista previa, protegidas,
 * motivo en fechas históricas, versión/auditoría). La prioridad es un dato de GENUS (base de datos), nunca de la Sheet.
 */
import { memo, useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { anchorInRect, type Pos } from "@/lib/semanas-sheet/calendar-grid-model";
import type { CalendarWeek } from "@/lib/semanas-sheet/calendar-model";
import { buildWeekModel, moveVisible, type CalendarSection, type CalendarTask, type SectionTitle, type TaskLine } from "@/lib/semanas-sheet/calendar-tasks";
import { PRIORITIES, PRIORITY_META, priorityOf, type PrioritiesPayload, type Priority } from "@/lib/semanas-sheet/priorities";
import { EngineBar, EngineNotice, EnginePreview, useCalendarEngine, type CalendarCommitChange, type CalendarCommitResult, type CalendarEngine } from "./semanas-calendar-engine";
import { PRIORITY_STYLE, PriorityBadge, PriorityChip } from "./semanas-priority-chip";

const DAY_SHORT = ["LUN", "MAR", "MIÉ", "JUE", "VIE"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function dayParts(iso: string | null): { dd: string; mon: string } | null {
  if (!iso) return null;
  const [, m, d] = iso.split("-");
  return { dd: String(Number(d)), mon: MONTHS[Number(m) - 1] ?? "" };
}

export interface SemanasCardsViewProps {
  tabKey: string;
  weeks: CalendarWeek[];
  weekId: string | null;
  today: string;
  canEdit: boolean;
  reasonRequiredBefore: string;
  historicNote?: string;
  priorities?: PrioritiesPayload;
  /** null = puede cambiar prioridades; si no, el motivo por el que no. */
  priorityLock: string | null;
  onPriorityChange: (task: CalendarTask, next: Priority) => Promise<void>;
  onCommit: (changes: CalendarCommitChange[]) => Promise<CalendarCommitResult>;
  /** Etiqueta del bloque de sección: «Responsable» en Elaboración, «Línea / área» en Acondicionamiento. */
  sectionLabel: string;
}

interface LineProps {
  e: CalendarEngine;
  weekId: string;
  line: { a1: string; ri: number; d: number; value: string; protection: string | null };
  className: string;
  readOnly: boolean;
}

/** Una celda de la Sheet mostrada dentro de una tarjeta (texto o editor en el lugar). */
const LineCell = memo(function LineCell({ e, weekId, line, className, readOnly }: LineProps) {
  const layout = e.layouts.get(weekId)!;
  const pos: Pos = { ri: line.ri, d: line.d };
  const mine = e.sel?.weekId === weekId;
  const selected = mine && e.selRect ? anchorInRect(layout, pos, e.selRect) : false;
  const isActive = mine && e.sel ? e.sel.anchor.ri === line.ri && e.sel.anchor.d === line.d : false;
  const isEditing = e.editing?.weekId === weekId && e.editing.pos.ri === line.ri && e.editing.pos.d === line.d;
  const ov = e.overlay[line.a1];
  const value = ov ? ov.value : line.value;
  if (isEditing) {
    return (
      <input
        autoFocus
        data-testid="semanas-cal-input"
        data-a1={line.a1}
        defaultValue={e.editing!.initial}
        className={`${className} w-full rounded-md border-0 bg-[var(--os-bg)] px-1.5 text-[var(--os-text)] outline outline-2 outline-[var(--os-teal)]`}
        onKeyDown={(ev) => {
          if (ev.key === "Enter") { ev.preventDefault(); e.finishEdit(true, ev.currentTarget.value, "down"); }
          else if (ev.key === "Tab") { ev.preventDefault(); e.finishEdit(true, ev.currentTarget.value, "right"); }
          else if (ev.key === "Escape") { ev.preventDefault(); e.finishEdit(false, "", null); }
          ev.stopPropagation();
        }}
        onBlur={(ev) => e.finishEdit(true, ev.currentTarget.value, null)}
      />
    );
  }
  return (
    <div
      data-a1={line.a1}
      data-r={line.ri}
      data-d={line.d}
      data-protected={line.protection ? "1" : undefined}
      data-status={ov?.status}
      aria-selected={selected}
      title={line.protection ?? undefined}
      onMouseDown={(ev) => {
        if ((ev.target as HTMLElement).tagName === "INPUT") return;
        e.onCellDown(weekId, pos, ev.shiftKey);
      }}
      onMouseEnter={() => e.onCellEnter(weekId, pos)}
      onDoubleClick={() => e.startEdit(weekId, pos)}
      className={[
        className,
        "relative -mx-1 rounded-md px-1 transition-colors",
        readOnly || line.protection ? "cursor-default" : "cursor-text",
        selected ? "bg-[rgba(20,184,166,0.22)]" : "hover:bg-white/5",
        isActive ? "outline outline-2 outline-[var(--os-teal)]" : "",
        ov?.status === "saving" ? "opacity-60" : "",
        ov?.status === "error" ? "outline outline-2 outline-red-500" : "",
      ].join(" ")}
    >
      {value}
      {line.protection && selected && <Lock className="ml-1 inline size-3 opacity-70" aria-label="Celda protegida" />}
    </div>
  );
});

const ROLE_CLASS: Record<TaskLine["role"], string> = {
  client: "text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--os-text-muted)]",
  product: "text-[17px] font-extrabold leading-snug text-[var(--os-text)] xl:text-lg",
  quantity: "mt-0.5 w-fit text-[15px] font-bold tabular-nums text-[var(--os-teal)]",
  note: "mt-1 w-fit rounded-md bg-amber-400/15 px-1.5 text-xs font-semibold text-amber-200",
};

interface TaskCardProps {
  e: CalendarEngine;
  weekId: string;
  task: CalendarTask;
  priority: Priority;
  priorityInfo?: string;
  priorityLock: string | null;
  busy: boolean;
  onPriority: (p: Priority) => void;
  readOnly: boolean;
}

const TaskCard = memo(function TaskCard({ e, weekId, task, priority, priorityInfo, priorityLock, busy, onPriority, readOnly }: TaskCardProps) {
  const st = PRIORITY_STYLE[priority];
  return (
    <article
      data-testid="task-card"
      data-task-key={task.key}
      data-priority={priority}
      className="rounded-xl border border-[var(--os-border)] bg-[var(--os-surface)] p-3 shadow-sm"
      style={{ borderLeft: `6px solid ${st.accent}`, background: priority === "URGENTE" ? `linear-gradient(90deg, ${st.soft}, transparent 55%), var(--os-surface)` : undefined }}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          {task.lines.filter((l) => l.role === "client").map((l) => (
            <LineCell key={l.a1} e={e} weekId={weekId} line={l} className={ROLE_CLASS.client} readOnly={readOnly} />
          ))}
        </div>
        <PriorityChip priority={priority} readOnlyReason={priorityLock} onChange={onPriority} busy={busy} info={priorityInfo} />
      </div>
      <div className="space-y-0.5">
        {task.lines.filter((l) => l.role !== "client").map((l) => (
          <LineCell key={l.a1} e={e} weekId={weekId} line={l} className={ROLE_CLASS[l.role]} readOnly={readOnly} />
        ))}
      </div>
    </article>
  );
});

function SectionHeader({ e, weekId, title, label, readOnly }: { e: CalendarEngine; weekId: string; title: SectionTitle; label: string; readOnly: boolean }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-[var(--os-border)] pb-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--os-text-muted)]">{label}</span>
      <LineCell e={e} weekId={weekId} line={title} className="text-xl font-extrabold uppercase tracking-wide text-[var(--os-text)]" readOnly={readOnly} />
    </div>
  );
}

export function SemanasCardsView(props: SemanasCardsViewProps) {
  const { tabKey, weeks, weekId, today, canEdit, reasonRequiredBefore, priorities, priorityLock, onPriorityChange, onCommit, sectionLabel, historicNote } = props;
  const week = weeks.find((w) => w.id === weekId) ?? weeks[weeks.length - 1];
  const e = useCalendarEngine({ weeks: week ? [week] : [], canEdit, reasonRequiredBefore, onCommit, focusWeekId: week?.id, move: (layout, from, key) => moveVisible(layout.week, from, key) });
  const { boxRef, onKeyDown, onCopy, onPaste } = e;
  const model = useMemo(() => (week ? buildWeekModel(week, tabKey) : null), [week, tabKey]);
  const [filter, setFilter] = useState<Priority | "ALL">("ALL");
  const [byPriority, setByPriority] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  if (!week || !model) return <p className="text-sm text-[var(--os-text-muted)]">Sin semanas en esta pestaña.</p>;
  const prios = priorities?.byTask;
  const pr = (t: CalendarTask) => priorityOf(prios, t.key);
  const info = (t: CalendarTask) => {
    const s = prios?.[t.key];
    return s ? `${s.updatedByName || s.updatedBy} · ${new Date(s.updatedAt).toLocaleString("es-AR")}${s.relinked ? " · asociada por posición (el texto cambió)" : ""}` : "Prioridad inicial (NORMAL)";
  };
  const allTasks = model.sections.flatMap((s) => s.tasks);
  const counts = Object.fromEntries(PRIORITIES.map((p) => [p, allTasks.filter((t) => pr(t) === p).length])) as Record<Priority, number>;
  const shown = (tasks: CalendarTask[]) => {
    const list = tasks.filter((t) => filter === "ALL" || pr(t) === filter);
    return byPriority ? [...list].sort((a, b) => PRIORITY_META[pr(a)].rank - PRIORITY_META[pr(b)].rank) : list;
  };
  const change = async (task: CalendarTask, next: Priority) => {
    setBusyKey(task.key);
    try {
      await onPriorityChange(task, next);
    } finally {
      setBusyKey(null);
    }
  };
  const readOnly = !canEdit;

  const renderCard = (t: CalendarTask) => (
    <TaskCard key={t.key} e={e} weekId={week.id} task={t} priority={pr(t)} priorityInfo={info(t)} priorityLock={priorityLock} busy={busyKey === t.key} onPriority={(p) => void change(t, p)} readOnly={readOnly} />
  );

  return (
    <div className="space-y-3" data-testid="semanas-cards">
      <EngineBar e={e} />
      <EngineNotice e={e} />
      <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="semanas-priority-filters">
        <span className="text-[var(--os-text-muted)]">Prioridad:</span>
        {(["ALL", ...PRIORITIES] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setFilter(p)}
            aria-pressed={filter === p}
            data-testid={`priority-filter-${p}`}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${filter === p ? "border-[var(--os-teal)] bg-[var(--os-teal-soft)] text-[var(--os-text)]" : "border-[var(--os-border)] text-[var(--os-text-muted)] hover:border-[var(--os-teal)]"}`}
          >
            {p === "ALL" ? `Todas (${allTasks.length})` : `${PRIORITY_META[p].icon} ${PRIORITY_META[p].label} (${counts[p]})`}
          </button>
        ))}
        <label className="ml-2 flex items-center gap-1.5 text-xs text-[var(--os-text-muted)]">
          <input type="checkbox" checked={byPriority} onChange={(ev) => setByPriority(ev.target.checked)} data-testid="priority-sort" />
          Ordenar por prioridad (solo en pantalla; la planilla no cambia)
        </label>
      </div>
      {priorities && !priorities.available && (
        <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100" role="status" data-testid="priority-unavailable">
          Las prioridades todavía no están habilitadas en esta base (falta aplicar la migración 0041): se muestran como NORMAL y no se pueden cambiar.
        </p>
      )}

      <div
        ref={boxRef}
        role="grid"
        aria-label="Calendario operativo"
        tabIndex={0}
        className="rounded-2xl border border-[var(--os-border)] bg-[var(--os-bg)] p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-teal)] sm:p-4"
        data-testid="semanas-cards-board"
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onPaste={onPaste}
      >
        <h3 className="mb-3 text-sm font-semibold text-[var(--os-text-muted)]">Semana {week.label}</h3>
        {/* encabezado de días (escritorio) */}
        <div className="sticky top-0 z-10 mb-3 hidden grid-cols-5 gap-3 bg-[var(--os-bg)] pb-2 lg:grid" aria-hidden="true">
          {DAY_SHORT.map((label, d) => {
            const parts = dayParts(week.dates[d] ?? null);
            const isToday = week.dates[d] === today;
            return (
              <div key={label} className={`rounded-xl px-3 py-2 text-center ${isToday ? "bg-[var(--os-teal)] text-[#04201e]" : "bg-[var(--os-surface)] text-[var(--os-text)]"}`} data-testid={`day-header-${d}`}>
                <div className="text-xs font-bold tracking-[0.14em]">{label}{isToday ? " · HOY" : ""}</div>
                <div className="text-2xl font-extrabold leading-none">{parts?.dd ?? "—"} <span className="text-sm font-semibold opacity-80">{parts?.mon}</span></div>
              </div>
            );
          })}
        </div>

        <div className="space-y-6">
          {model.sections.map((sec: CalendarSection) => {
            const multi = shown(sec.tasks.filter((t) => t.span > 1));
            const single = sec.tasks.filter((t) => t.span <= 1);
            return (
              <section key={sec.index} data-testid="semanas-section" className="space-y-3">
                {sec.title && <SectionHeader e={e} weekId={week.id} title={sec.title} label={sectionLabel} readOnly={readOnly} />}
                {multi.length > 0 && (
                  <div className="grid gap-3 lg:grid-cols-5" data-testid="multi-day-strip">
                    {multi.map((t) => (
                      <div key={t.key} style={{ gridColumn: `${t.d + 1} / span ${Math.min(t.span, 5 - t.d)}` }} className="max-lg:!col-auto">
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">{DAY_SHORT[t.d]}{t.span > 1 ? ` → ${DAY_SHORT[Math.min(4, t.d + t.span - 1)]}` : ""}</div>
                        {renderCard(t)}
                      </div>
                    ))}
                  </div>
                )}
                <div className="grid gap-3 lg:grid-cols-5">
                  {DAY_SHORT.map((label, d) => {
                    const list = shown(single.filter((t) => t.d === d));
                    const parts = dayParts(week.dates[d] ?? null);
                    const isToday = week.dates[d] === today;
                    if (list.length === 0) return <div key={label} className="hidden lg:block" data-testid={`day-col-${d}`} />;
                    return (
                      <div key={label} className="space-y-2.5" data-testid={`day-col-${d}`}>
                        <div className={`rounded-lg px-2 py-1 text-xs font-bold tracking-[0.14em] lg:hidden ${isToday ? "bg-[var(--os-teal)] text-[#04201e]" : "bg-[var(--os-surface)] text-[var(--os-text-muted)]"}`}>
                          {label} {parts?.dd} {parts?.mon}{isToday ? " · HOY" : ""}
                        </div>
                        {list.map(renderCard)}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {model.sections.every((s) => s.tasks.length === 0) && <p className="text-sm text-[var(--os-text-muted)]">Sin tareas cargadas en esta semana.</p>}
        </div>
      </div>
      <p className="text-xs text-[var(--os-text-muted)]">
        Cada línea es una celda de la Sheet: clic para seleccionar, doble clic o Enter para editar, Esc cancela, Tab avanza; arrastrá para seleccionar y Ctrl+C / Ctrl+V para copiar y pegar. La prioridad es un dato de GENUS (no se escribe en la planilla). {historicNote}
      </p>
      <EnginePreview e={e} />
    </div>
  );
}

export { PriorityBadge };
