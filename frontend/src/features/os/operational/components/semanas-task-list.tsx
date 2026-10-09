"use client";

/**
 * Producción → Semanas: LISTA editable de las tareas de la semana (una fila por tarea).
 *
 * Cada campo (cliente, producto, cantidad, notas) es una celda de SEMANAS 2026: se hace clic y se edita en el lugar,
 * sin tarjetas flotantes. Enter guarda (y baja), Tab guarda (y avanza), Esc cancela; flechas para moverse; Ctrl+C / Ctrl+V
 * copian y pegan (un valor por fila hacia abajo). El guardado, las validaciones, el motivo en fechas pasadas, las celdas
 * protegidas, la auditoría y el control de conflictos son los MISMOS del motor de la planilla (useCalendarEngine →
 * PATCH /api/v1/semanas/cells): esta vista solo cambia la presentación.
 * Fecha y responsable/línea salen de la estructura de la planilla (columna del día y banda combinada): se muestran pero
 * no se reasignan desde acá, para no romper celdas combinadas. La prioridad es un dato de GENUS (no se escribe en la Sheet).
 */
import { Fragment, memo, useCallback, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { History, Lock, Search } from "lucide-react";
import type { CalendarWeek } from "@/lib/semanas-sheet/calendar-model";
import { parseClipboard, validateCalendarValue, type PlannedChange, type SkippedCell } from "@/lib/semanas-sheet/calendar-grid-model";
import { byPriority, formatDay, PLAN_SECTOR_LABEL, projectPlanTasks, type PlanTask, type PlanTaskLine } from "@/lib/semanas-sheet/plan-tasks";
import { PRIORITIES, PRIORITY_META, type PrioritiesPayload, type Priority } from "@/lib/semanas-sheet/priorities";
import type { TaskHistory } from "@/lib/semanas-sheet/semanas-client";
import type { LinkView, TaskLinksPayload } from "@/lib/semanas-sheet/task-links";
import { LinkCell, LinkPanel, type LinkActions } from "./semanas-link-panel";
import { EngineNotice, EnginePreview, useCalendarEngine, type CalendarCommitChange, type CalendarCommitResult, type CalendarEngine } from "./semanas-calendar-engine";
import { PRIORITY_STYLE, PriorityChip } from "./semanas-priority-chip";

/** Columnas de la lista. `role` = qué líneas de la tarea se editan en esa columna. */
const COLS = [
  { id: "priority", title: "Prioridad", w: "w-[9.5rem]" },
  { id: "date", title: "Fecha", w: "w-[7.5rem]" },
  { id: "assignee", title: "Responsable / sector", w: "w-[10rem]" },
  { id: "client", title: "Cliente", role: "client", w: "w-[11rem]" },
  { id: "product", title: "Producto", role: "product", w: "" },
  { id: "quantity", title: "Cantidad", role: "quantity", w: "w-[9rem]" },
  { id: "note", title: "Notas", role: "note", w: "w-[8rem]" },
] as const;
type ColId = (typeof COLS)[number]["id"];
const EDITABLE: Record<ColId, PlanTaskLine["role"] | null> = { priority: null, date: null, assignee: null, client: "client", product: "product", quantity: "quantity", note: "note" };

interface Focus { row: number; col: number; sub: number }

export interface SemanasTaskListProps {
  tabKey: "ELABORACION" | "ACONDICIONAMIENTO";
  tab: string;
  week: CalendarWeek;
  today: string;
  canEdit: boolean;
  reasonRequiredBefore: string;
  priorities?: PrioritiesPayload;
  /** null = puede cambiar prioridades; si no, el motivo por el que no. */
  priorityLock: string | null;
  onPriorityChange: (taskKey: string, next: Priority) => Promise<void>;
  onCommit: (changes: CalendarCommitChange[]) => Promise<CalendarCommitResult>;
  loadHistory?: (taskKey: string) => Promise<TaskHistory>;
  /** Vínculos con trabajos operativos (0042) y acciones de Producción. */
  links?: TaskLinksPayload;
  linkActions?: LinkActions;
  footnote?: string;
}

function linesOf(t: PlanTask, col: ColId): PlanTaskLine[] {
  const role = EDITABLE[col];
  return role ? t.lines.filter((l) => l.role === role) : [];
}

export function SemanasTaskList(props: SemanasTaskListProps) {
  const { tabKey, tab, week, today, canEdit, reasonRequiredBefore, priorities, priorityLock, onPriorityChange, onCommit, loadHistory, footnote, linkActions } = props;
  // Sin planificación nativa (p. ej. la copia de Preview) no hay trabajos que vincular: no se muestra la columna.
  const links = props.links?.available ? props.links : undefined;
  const [linkOpen, setLinkOpen] = useState<string | null>(null);
  const NO_LINKS: LinkView[] = [];
  const weeks = useMemo(() => [week], [week]);
  const e = useCalendarEngine({ weeks, canEdit, reasonRequiredBefore, onCommit, focusWeekId: null });
  const all = useMemo(() => projectPlanTasks(tabKey, weeks, tab, priorities, { withCells: true }), [tabKey, weeks, tab, priorities]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Priority | "ALL">("ALL");
  const [section, setSection] = useState<string>("ALL");
  const [sortByPriority, setSortByPriority] = useState(false);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [history, setHistory] = useState<{ key: string; data: TaskHistory | null; error: string | null } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const sections = useMemo(() => [...new Set(all.map((t) => t.section ?? "(sin banda)"))], [all]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = all.filter(
      (t) =>
        (filter === "ALL" || t.priority === filter) &&
        (section === "ALL" || (t.section ?? "(sin banda)") === section) &&
        (!q || t.lines.some((l) => l.value.toLowerCase().includes(q)) || (t.section ?? "").toLowerCase().includes(q))
    );
    // Agrupada por DÍA (y por sector/responsable dentro del día, en el orden de la planilla). «Ordenar por prioridad»
    // ordena dentro de cada día: el día sigue siendo el eje de la planificación semanal.
    const dayOrder = (t: PlanTask) => t.date ?? `9999-${t.d}`;
    const sectionOrder = new Map(all.map((t, i) => [t.key, i] as const));
    const sorted = [...list].sort((x, y) => dayOrder(x).localeCompare(dayOrder(y)) || (sectionOrder.get(x.key)! - sectionOrder.get(y.key)!));
    if (!sortByPriority) return sorted;
    const days = [...new Set(sorted.map(dayOrder))];
    return days.flatMap((d) => byPriority(sorted.filter((t) => dayOrder(t) === d)));
  }, [all, filter, section, query, sortByPriority]);
  const counts = useMemo(() => Object.fromEntries(PRIORITIES.map((p) => [p, all.filter((t) => t.priority === p).length])) as Record<Priority, number>, [all]);

  const valueOf = useCallback((l: PlanTaskLine) => e.overlay[l.a1!]?.value ?? l.value, [e.overlay]);
  const lockOf = useCallback((l: PlanTaskLine | undefined): string | null => {
    if (!l) return "La planilla no tiene este dato para esta tarea (se agrega desde la planilla).";
    if (!canEdit) return "Solo lectura: la escritura a esta planilla no está habilitada desde GENUS.";
    return l.protection ?? null;
  }, [canEdit]);

  const focusBox = () => boxRef.current?.focus({ preventScroll: true });
  const lineAt = (f: Focus | null) => (f ? linesOf(rows[f.row]!, COLS[f.col]!.id)[f.sub] : undefined);

  const beginEdit = (f: Focus, initial?: string) => {
    const l = lineAt(f);
    const why = lockOf(l);
    setFocus(f);
    if (EDITABLE[COLS[f.col]!.id] === null) { focusBox(); return; }
    if (why) { e.setNotice(`No editable: ${why}`); focusBox(); return; }
    e.setNotice(null);
    e.startEdit(week.id, { ri: l!.ri!, d: l!.d! }, initial);
  };

  const move = useCallback((f: Focus, key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"): Focus => {
    const n = (r: number, c: number) => Math.max(1, linesOf(rows[r]!, COLS[c]!.id).length);
    if (key === "ArrowLeft") return { row: f.row, col: Math.max(0, f.col - 1), sub: 0 };
    if (key === "ArrowRight") return { row: f.row, col: Math.min(COLS.length - 1, f.col + 1), sub: 0 };
    if (key === "ArrowDown") return f.sub + 1 < n(f.row, f.col) ? { ...f, sub: f.sub + 1 } : { row: Math.min(rows.length - 1, f.row + 1), col: f.col, sub: f.row + 1 < rows.length ? 0 : f.sub };
    return f.sub > 0 ? { ...f, sub: f.sub - 1 } : f.row > 0 ? { row: f.row - 1, col: f.col, sub: n(f.row - 1, f.col) - 1 } : f;
  }, [rows]);

  const finish = (commit: boolean, value: string, dir: "down" | "right" | null) => {
    e.finishEdit(commit, value, null);
    if (focus && dir) setFocus(move(focus, dir === "down" ? "ArrowDown" : "ArrowRight"));
    focusBox();
  };

  const setPriority = async (t: PlanTask, p: Priority) => {
    if (priorityLock || p === t.priority) return;
    setBusyKey(t.key);
    try {
      await onPriorityChange(t.key, p);
    } finally {
      setBusyKey(null);
    }
  };

  const onKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    const tag = (ev.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !focus || rows.length === 0) return;
    const colId = COLS[focus.col]!.id;
    if (ev.key.startsWith("Arrow")) { ev.preventDefault(); setFocus(move(focus, ev.key as "ArrowUp")); return; }
    if (ev.key === "Tab") { ev.preventDefault(); setFocus(move(focus, ev.shiftKey ? "ArrowLeft" : "ArrowRight")); return; }
    if (ev.key === "Escape") { setFocus(null); return; }
    if (colId === "priority") {
      // 1 / 2 / 3 = URGENTE / IMPORTANTE / NORMAL (atajo de teclado, mismas reglas que el menú).
      const idx = ["1", "2", "3"].indexOf(ev.key);
      if (idx >= 0) { ev.preventDefault(); void setPriority(rows[focus.row]!, PRIORITIES[idx]!); }
      return;
    }
    if (ev.key === "Enter" || ev.key === "F2") { ev.preventDefault(); beginEdit(focus); return; }
    if (ev.key === "Delete" || ev.key === "Backspace") {
      ev.preventDefault();
      const l = lineAt(focus);
      const why = lockOf(l);
      if (why) { e.setNotice(`No editable: ${why}`); return; }
      if (valueOf(l!).trim()) e.request(week.id, [{ a1: l!.a1!, oldValue: l!.value, newValue: "", date: week.dates[l!.d!] ?? null }], [], []);
      return;
    }
    if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) { ev.preventDefault(); beginEdit(focus, ev.key); }
  };

  const onCopy = (ev: ClipboardEvent<HTMLDivElement>) => {
    if ((ev.target as HTMLElement).tagName === "INPUT" || !focus) return;
    const t = rows[focus.row]!;
    const colId = COLS[focus.col]!.id;
    const text = colId === "priority" ? t.priority : colId === "date" ? formatDay(t.date) : colId === "assignee" ? (t.assignee?.value ?? t.section ?? "") : (lineAt(focus) ? valueOf(lineAt(focus)!) : "");
    ev.clipboardData.setData("text/plain", text);
    ev.preventDefault();
  };

  const onPaste = (ev: ClipboardEvent<HTMLDivElement>) => {
    if ((ev.target as HTMLElement).tagName === "INPUT" || !focus) return;
    ev.preventDefault();
    if (EDITABLE[COLS[focus.col]!.id] === null) { e.setNotice("Esa columna no se pega: elegí cliente, producto, cantidad o notas."); return; }
    // Una línea por fila, hacia abajo (primera celda de la columna en cada tarea); se ignoran columnas extra.
    const values = parseClipboard(ev.clipboardData.getData("text/plain")).map((r) => r[0] ?? "");
    const changes: PlannedChange[] = [];
    const skipped: SkippedCell[] = [];
    const invalid: Array<{ a1: string; message: string }> = [];
    values.forEach((raw, i) => {
      const t = rows[focus.row + i];
      if (!t) return;
      const l = linesOf(t, COLS[focus.col]!.id)[i === 0 ? focus.sub : 0];
      const why = lockOf(l);
      if (why) { skipped.push({ a1: l?.a1 ?? `fila ${focus.row + i + 1}`, reason: why }); return; }
      const next = raw.trim();
      const problem = validateCalendarValue(next);
      if (problem) { invalid.push({ a1: l!.a1!, message: problem }); return; }
      if (next !== valueOf(l!).trim()) changes.push({ a1: l!.a1!, oldValue: l!.value, newValue: next, date: week.dates[l!.d!] ?? null });
    });
    e.request(week.id, changes, skipped, invalid);
  };

  const openHistory = async (t: PlanTask) => {
    if (!loadHistory) return;
    if (history?.key === t.key) { setHistory(null); return; }
    setHistory({ key: t.key, data: null, error: null });
    try {
      const data = await loadHistory(t.key);
      setHistory((h) => (h?.key === t.key ? { key: t.key, data, error: null } : h));
    } catch (err) {
      setHistory((h) => (h?.key === t.key ? { key: t.key, data: null, error: err instanceof Error ? err.message : "No se pudo leer el historial." } : h));
    }
  };

  return (
    <div className="space-y-3" data-testid="semanas-list">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--os-text-muted)]" aria-hidden="true" />
          <input
            value={query}
            onChange={(ev) => setQuery(ev.target.value)}
            placeholder="Buscar producto, cliente…"
            aria-label="Buscar"
            data-testid="semanas-list-search"
            className="w-56 rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] py-1.5 pl-8 pr-2 text-sm"
          />
        </label>
        <div className="flex flex-wrap items-center gap-1.5" data-testid="semanas-priority-filters">
          {(["ALL", ...PRIORITIES] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setFilter(p)}
              aria-pressed={filter === p}
              data-testid={`priority-filter-${p}`}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${filter === p ? "border-[var(--os-teal)] bg-[var(--os-teal-soft)] text-[var(--os-text)]" : "border-[var(--os-border)] text-[var(--os-text-muted)] hover:border-[var(--os-teal)]"}`}
            >
              {p !== "ALL" && <span className="size-2 rounded-full" style={{ background: PRIORITY_STYLE[p].accent }} aria-hidden="true" />}
              {p === "ALL" ? `Todas (${all.length})` : `${PRIORITY_META[p].label} (${counts[p]})`}
            </button>
          ))}
        </div>
        {sections.length > 1 && (
          <select value={section} onChange={(ev) => setSection(ev.target.value)} aria-label="Responsable / sector" data-testid="semanas-list-section" className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-2 py-1.5 text-sm">
            <option value="ALL">Todos los responsables / sectores</option>
            {sections.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-1.5 text-xs text-[var(--os-text-muted)]">
          <input type="checkbox" checked={sortByPriority} onChange={(ev) => setSortByPriority(ev.target.checked)} data-testid="priority-sort" />
          Ordenar por prioridad
        </label>
        <span className="ml-auto text-xs text-[var(--os-text-muted)]" role="status" data-testid="semanas-cal-status">
          {e.saving ? "Guardando…" : e.lastSaved ? `Guardado (${e.lastSaved})` : ""}
        </span>
      </div>
      <EngineNotice e={e} />
      {props.links && !props.links.available && (
        <p className="text-xs text-[var(--os-text-muted)]" data-testid="links-unavailable">
          Vincular tareas con trabajos de «Mi trabajo» requiere la planificación nativa (base de datos con la migración 0042).
        </p>
      )}
      {priorities && !priorities.available && (
        <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100" role="status" data-testid="priority-unavailable">
          Las prioridades todavía no están habilitadas en esta base (falta aplicar la migración 0041): se muestran como NORMAL y no se pueden cambiar.
        </p>
      )}

      <div
        ref={boxRef}
        tabIndex={0}
        role="grid"
        aria-label={`Tareas de la semana ${week.label}`}
        aria-rowcount={rows.length}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onPaste={onPaste}
        className="overflow-x-auto rounded-2xl border border-[var(--os-border)] bg-[var(--os-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-teal)]"
        data-testid="semanas-list-grid"
      >
        <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              {COLS.map((c) => (
                <th key={c.id} scope="col" className={`${c.w} border-b border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--os-text-muted)]`}>
                  {c.title}
                </th>
              ))}
              {links && (
                <th scope="col" className="w-[12rem] border-b border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--os-text-muted)]">
                  Trabajo vinculado
                </th>
              )}
              <th className="w-10 border-b border-[var(--os-border)] bg-[var(--os-surface)]" aria-label="Historial" />
            </tr>
          </thead>
          <tbody>
            {rows.map((t, r) => (
              <Fragment key={t.key}>
              {(r === 0 || rows[r - 1]!.date !== t.date) && (
                <tr data-testid="list-day-header" data-date={t.date ?? ""}>
                  <th colSpan={COLS.length + 1 + (links ? 1 : 0)} scope="rowgroup" className={`border-b border-[var(--os-border)] px-3 pb-2 pt-4 text-left ${t.date === today ? "text-[var(--os-teal)]" : "text-[var(--os-text)]"}`}>
                    <span className="text-base font-extrabold tracking-tight">{formatDay(t.date, { long: true })}</span>
                    {t.date === today && <span className="ml-2 rounded-full bg-[var(--os-teal)] px-2 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wider text-[#04201e]">Hoy</span>}
                    <span className="ml-3 text-xs font-semibold text-[var(--os-text-muted)]">
                      {rows.filter((x) => x.date === t.date).length} tareas
                      {PRIORITIES.filter((p) => p !== "NORMAL").map((p) => {
                        const n = rows.filter((x) => x.date === t.date && x.priority === p).length;
                        return n ? <span key={p} className="ml-2" style={{ color: PRIORITY_STYLE[p].accent }}>● {n} {PRIORITY_META[p].label.toLowerCase()}</span> : null;
                      })}
                    </span>
                  </th>
                </tr>
              )}
              {tabKey === "ACONDICIONAMIENTO" && t.sector && (r === 0 || rows[r - 1]!.date !== t.date || rows[r - 1]!.sector !== t.sector) && !sortByPriority && (
                <tr data-testid="list-sector-header">
                  <th colSpan={COLS.length + 1 + (links ? 1 : 0)} scope="rowgroup" className="border-b border-[var(--os-border)] bg-[var(--os-surface)]/60 px-3 py-1 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--os-text-muted)]">
                    {PLAN_SECTOR_LABEL[t.sector]}
                  </th>
                </tr>
              )}
              <TaskRow
                key={t.key}
                t={t}
                r={r}
                e={e}
                weekId={week.id}
                today={today}
                focus={focus?.row === r ? focus : null}
                busy={busyKey === t.key}
                priorityLock={priorityLock}
                lockOf={lockOf}
                valueOf={valueOf}
                onPick={(f) => setFocus(f)}
                onEdit={beginEdit}
                onFinish={finish}
                onPriority={(p) => void setPriority(t, p)}
                onHistory={loadHistory ? () => void openHistory(t) : undefined}
                history={history?.key === t.key ? history : null}
                links={links ? (links.byTask[t.key] ?? NO_LINKS) : null}
                linksAvailable={Boolean(links?.available)}
                linkOpen={linkOpen === t.key}
                onToggleLink={() => setLinkOpen((k) => (k === t.key ? null : t.key))}
                linkActions={linkActions}
              />
              </Fragment>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-4 py-6 text-sm text-[var(--os-text-muted)]">{all.length === 0 ? "Sin tareas cargadas en esta semana." : "Ninguna tarea coincide con los filtros."}</p>}
      </div>
      <p className="text-xs text-[var(--os-text-muted)]">
        Clic en un campo para editarlo · Enter guarda · Esc cancela · Tab / flechas para moverse · Ctrl+C / Ctrl+V copian y pegan · en Prioridad, 1 / 2 / 3 = URGENTE / IMPORTANTE / NORMAL. Cada campo es una celda de la planilla; la prioridad es un dato de GENUS. {footnote}
      </p>
      <EnginePreview e={e} />
    </div>
  );
}

interface RowProps {
  t: PlanTask;
  r: number;
  e: CalendarEngine;
  weekId: string;
  today: string;
  focus: Focus | null;
  busy: boolean;
  priorityLock: string | null;
  lockOf: (l: PlanTaskLine | undefined) => string | null;
  valueOf: (l: PlanTaskLine) => string;
  onPick: (f: Focus) => void;
  onEdit: (f: Focus) => void;
  onFinish: (commit: boolean, value: string, dir: "down" | "right" | null) => void;
  onPriority: (p: Priority) => void;
  onHistory?: () => void;
  history: { data: TaskHistory | null; error: string | null } | null;
  links: LinkView[] | null;
  linksAvailable: boolean;
  linkOpen: boolean;
  onToggleLink: () => void;
  linkActions?: LinkActions;
}

const FIELD_CLASS: Record<string, string> = {
  client: "font-semibold uppercase tracking-wide text-[13px] text-[#cfe0ea]",
  product: "font-bold text-[15px] text-white",
  quantity: "font-extrabold tabular-nums text-[15px] text-[#5eead4]",
  note: "text-[13px] font-semibold text-amber-200",
};

const TaskRow = memo(function TaskRow({ t, r, e, weekId, today, focus, busy, priorityLock, lockOf, valueOf, onPick, onEdit, onFinish, onPriority, onHistory, history, links, linksAvailable, linkOpen, onToggleLink, linkActions }: RowProps) {
  const colSpan = COLS.length + 1 + (links ? 1 : 0);
  const st = PRIORITY_STYLE[t.priority];
  const cellBase = "border-b border-[var(--os-border)] px-3 py-2 align-top";
  const ring = (c: number) => (focus?.col === c ? "outline outline-2 -outline-offset-2 outline-[var(--os-teal)]" : "");
  const info = t.priorityInfo
    ? `${t.priorityInfo.updatedByName || t.priorityInfo.updatedBy} · ${new Date(t.priorityInfo.updatedAt).toLocaleString("es-AR")}${t.priorityInfo.moved ? " · siguió a la tarea al moverse de día" : t.priorityInfo.relinked ? " · asociada por posición (el texto cambió)" : ""}`
    : "Prioridad inicial (NORMAL)";
  const isPast = Boolean(t.date && t.date < today);
  return (
    <>
      <tr data-testid="list-row" data-task-key={t.key} data-priority={t.priority} className="group bg-[var(--os-surface)]/40 hover:bg-[var(--os-surface)]">
        <td className={`${cellBase} ${ring(0)}`} style={{ boxShadow: `inset 4px 0 0 ${st.accent}` }} onMouseDown={() => onPick({ row: r, col: 0, sub: 0 })}>
          <PriorityChip priority={t.priority} readOnlyReason={priorityLock} onChange={onPriority} busy={busy} info={info} />
        </td>
        <td className={`${cellBase} ${ring(1)} whitespace-nowrap`} onMouseDown={() => onPick({ row: r, col: 1, sub: 0 })} title="La fecha es la columna del día en la planilla.">
          <div className={`font-semibold ${t.date === today ? "text-[var(--os-teal)]" : isPast ? "text-[var(--os-text-muted)]" : "text-[var(--os-text)]"}`} data-testid="list-date">
            {formatDay(t.date)}
            {t.date === today ? " · hoy" : ""}
          </div>
          {t.span > 1 && t.endDate !== t.date && <div className="text-xs text-[var(--os-text-muted)]">hasta {formatDay(t.endDate)}</div>}
        </td>
        <td className={`${cellBase} ${ring(2)}`} onMouseDown={() => onPick({ row: r, col: 2, sub: 0 })} title="Banda (celda combinada) de la planilla.">
          {t.assignee ? (
            <>
              <div className="font-semibold text-[var(--os-text)]" data-testid="list-assignee">{t.assignee.value}</div>
              <div className="text-[11px] uppercase tracking-wide text-[var(--os-text-muted)]">{t.assignee.kind === "LÍNEA" ? "Línea" : "Responsable"}{t.sector && t.tabKey !== "ELABORACION" ? ` · ${PLAN_SECTOR_LABEL[t.sector]}` : ""}</div>
            </>
          ) : (
            <div className="font-semibold text-[var(--os-text)]" data-testid="list-assignee">{t.sector ? PLAN_SECTOR_LABEL[t.sector] : (t.section ?? "—")}</div>
          )}
        </td>
        {COLS.slice(3).map((c, i) => {
          const col = i + 3;
          const role = EDITABLE[c.id]!;
          const lines = t.lines.filter((l) => l.role === role);
          return (
            <td key={c.id} className={cellBase} data-col={c.id}>
              {lines.length === 0 ? (
                <div
                  className={`rounded px-1 text-[var(--os-text-muted)]/60 ${focus?.col === col ? "outline outline-2 outline-[var(--os-teal)]" : ""}`}
                  onMouseDown={() => onPick({ row: r, col, sub: 0 })}
                  title={lockOf(undefined) ?? undefined}
                >
                  —
                </div>
              ) : (
                lines.map((l, sub) => (
                  <FieldLine
                    key={l.a1}
                    e={e}
                    weekId={weekId}
                    line={l}
                    value={valueOf(l)}
                    lock={lockOf(l)}
                    className={FIELD_CLASS[role]!}
                    active={focus?.col === col && focus.sub === sub}
                    onClick={() => onEdit({ row: r, col, sub })}
                    onFinish={onFinish}
                  />
                ))
              )}
            </td>
          );
        })}
        {links && (
          <td className={cellBase}>
            <LinkCell links={links} open={linkOpen} onToggle={onToggleLink} available={linksAvailable} />
          </td>
        )}
        <td className={`${cellBase} text-center`}>
          {onHistory && (
            <button type="button" onClick={onHistory} className="rounded p-1 text-[var(--os-text-muted)] hover:bg-white/10 hover:text-[var(--os-text)]" title="Historial de prioridad" aria-label="Historial de prioridad" data-testid="list-history">
              <History className="size-4" />
            </button>
          )}
        </td>
      </tr>
      {links && linkOpen && linkActions && <LinkPanel task={t} links={links} actions={linkActions} colSpan={colSpan} />}
      {history && (
        <tr data-testid="list-history-row">
          <td colSpan={colSpan} className="border-b border-[var(--os-border)] bg-[var(--os-bg)] px-4 py-2 text-xs text-[var(--os-text-muted)]">
            <div>
              <span className="mr-2 font-semibold uppercase tracking-wide">Historial de prioridad</span>
              {history.error ? history.error : !history.data ? "Cargando…" : history.data.events.length === 0 ? "Sin cambios registrados (NORMAL inicial)." : history.data.events.map((ev, i) => (
                <span key={i} className="mr-4 inline-block">
                  {new Date(ev.at).toLocaleString("es-AR")} · {ev.actorName || ev.actorEmail}: {ev.from} → <b className="text-[var(--os-text)]">{ev.to}</b>
                </span>
              ))}
            </div>
            {history.data && history.data.linkEvents.length > 0 && (
              <div className="mt-1" data-testid="list-history-links">
                <span className="mr-2 font-semibold uppercase tracking-wide">Vínculos</span>
                {history.data.linkEvents.map((ev, i) => (
                  <span key={i} className="mr-4 inline-block">
                    {new Date(ev.at).toLocaleString("es-AR")} · {ev.actorName || ev.actorEmail}: <b className="text-[var(--os-text)]">{ev.action === "LINK" ? "vinculó" : "quitó"}</b> {ev.workItemSummary}
                    {ev.reason ? ` — «${ev.reason}»` : ""}
                  </span>
                ))}
              </div>
            )}
            <span className="ml-2 font-mono opacity-70">Celdas: {t.lines.map((l) => l.a1).join(", ")}</span>
          </td>
        </tr>
      )}
    </>
  );
});

function FieldLine({ e, weekId, line, value, lock, className, active, onClick, onFinish }: {
  e: CalendarEngine; weekId: string; line: PlanTaskLine; value: string; lock: string | null; className: string; active: boolean;
  onClick: () => void; onFinish: (commit: boolean, value: string, dir: "down" | "right" | null) => void;
}) {
  const editing = e.editing?.weekId === weekId && e.editing.pos.ri === line.ri && e.editing.pos.d === line.d;
  const ov = e.overlay[line.a1!];
  if (editing) {
    return (
      <input
        autoFocus
        data-testid="semanas-cal-input"
        data-a1={line.a1}
        defaultValue={e.editing!.initial}
        className={`${className} -mx-1 w-full rounded-md border-0 bg-[var(--os-bg)] px-1 outline outline-2 outline-[var(--os-teal)]`}
        onKeyDown={(ev) => {
          if (ev.key === "Enter") { ev.preventDefault(); onFinish(true, ev.currentTarget.value, "down"); }
          else if (ev.key === "Tab") { ev.preventDefault(); onFinish(true, ev.currentTarget.value, "right"); }
          else if (ev.key === "Escape") { ev.preventDefault(); onFinish(false, "", null); }
          ev.stopPropagation();
        }}
        onBlur={(ev) => onFinish(true, ev.currentTarget.value, null)}
      />
    );
  }
  return (
    <div
      data-a1={line.a1}
      data-field-line
      data-protected={lock ? "1" : undefined}
      data-status={ov?.status}
      title={lock ?? "Clic para editar"}
      onMouseDown={(ev) => {
        ev.preventDefault();
        // Si había otra celda en edición, se confirma primero (blur → guarda) y recién después se abre esta.
        if (e.editing) (document.activeElement as HTMLElement | null)?.blur();
        onClick();
      }}
      className={[
        className,
        "-mx-1 rounded-md px-1 leading-snug transition-colors",
        lock ? "cursor-default" : "cursor-text hover:bg-white/5",
        active ? "outline outline-2 outline-[var(--os-teal)]" : "",
        ov?.status === "saving" ? "opacity-60" : "",
        ov?.status === "error" ? "outline outline-2 outline-red-500" : "",
      ].join(" ")}
    >
      {value || <span className="opacity-40">(vacío)</span>}
      {lock && active && <Lock className="ml-1 inline size-3 opacity-70" aria-label="No editable" />}
    </div>
  );
}
