"use client";

/**
 * «Mi trabajo» en TARJETAS (vista por defecto del día): mismo lenguaje visual que Semanas — producto y cantidad
 * destacados, prioridad con etiqueta y borde lateral, datos con su rótulo — sobre el azul marino de GENUS OS.
 *
 * Operarios y encargados: SOLO LECTURA de la planificación; sus acciones operativas no cambian (el botón abre el mismo
 * detalle con «Guardar avance», «Finalizar…», Codificado, etc.; archivar de su vista sigue igual).
 * Producción: edita en el lugar los campos de planificación (producto, cliente, cantidad, unidad, fecha, entrega,
 * responsable / línea y observación de planificación) con la MISMA política y la MISMA escritura que la planilla
 * (PATCH /api/v1/work-items/cells: versión, motivo cuando corresponde, auditoría), y la prioridad de Semanas cuando el
 * trabajo está vinculado (misma tabla y API que Semanas). Las diferencias con la tarea de Semanas se MUESTRAN; nunca se
 * da por sincronizado algo que vive en otro sistema.
 */
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, Check, Link2, Lock, Pencil, X } from "lucide-react";
import { displayField } from "@/lib/operational/display-fields";
import { formatDay, isPlanSector, type PlanSector, type PlanTask } from "@/lib/semanas-sheet/plan-tasks";
import { fetchSectorPlan, patchTaskPriority, postTaskLink } from "@/lib/semanas-sheet/semanas-client";
import type { Priority } from "@/lib/semanas-sheet/priorities";
import { planDivergences } from "@/lib/semanas-sheet/task-links";
import { isNativeWorkItemId, isWorkItemReported, MIN_WORK_ITEM_REASON, workItemReasonRequired, type WorkItemCellField } from "@/lib/planning/work-item-cell-edit";
import { VIEW_ARCHIVE_TOOLTIP } from "@/lib/work-view-archive";
import type { WorkItem } from "@/types/operational/work-item";
import { usePreviewContext, usePreviewSession } from "@/features/os/session/preview-context";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import { useReloadWorkItemPriorities, useWorkItemPrioritiesAvailable, useWorkItemSemanasPriority } from "../hooks/use-work-item-priorities";
import type { useWorkItemCellEditing } from "../hooks/use-work-item-cells";
import { formatOperationalDifference, plannedQuantityLabel } from "../lib/operational-progress";
import { formatDateDisplay } from "../lib/delivery-date";
import { isWorkTransferredStatus, WORK_TRANSFER } from "../lib/work-transfer-labels";
import { ActionButton, StatusChip } from "./operational-ui";
import { DeliveryDateBadge } from "./delivery-date-badge";
import { PriorityTag } from "./plan-task-card";
import { PriorityChip } from "./semanas-priority-chip";
import { priorityEdge, WorkItemPriorityBadge } from "./work-item-priority-badge";
import { WorkItemWarningBadge } from "./work-item-warning-badge";

type CellEditing = ReturnType<typeof useWorkItemCellEditing>;
const todayIso = () => new Date().toISOString().slice(0, 10);

export interface WorkItemCardsProps {
  items: WorkItem[];
  variant: "envasado" | "elaboracion";
  getFinishedQty: (itemId: string) => string;
  getObservation: (itemId: string) => string;
  onSelectItem: (item: WorkItem) => void;
  listMode?: "active" | "archived";
  onArchiveFromView?: (item: WorkItem) => void;
  onRestoreToView?: (item: WorkItem) => void;
  archiveBusyId?: string | null;
  showPackagingColumns?: boolean;
  cells: CellEditing;
  /** Dentro del detalle (editor de planificación): sin los botones de la lista. */
  hideActions?: boolean;
}

const LABEL = "text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8fb3c9]";

/** Opciones de responsable / línea según el sector del trabajo (la combinación la valida el servidor). */
export function assigneeOptions(item: Pick<WorkItem, "sector">, variant: "envasado" | "elaboracion"): string[] {
  if (variant === "elaboracion" || item.sector === "ELABORACION") return ["Cristian", "Nicolás"];
  if (item.sector === "ENVASADO_PREMIUM") return ["Línea 1", "Línea 2"];
  return ["Línea 1", "Línea 2", "Línea 3", "Línea 4"];
}

/**
 * Un campo de planificación. Para todos: el dato. Para Producción: lápiz visible → editor en el lugar con
 * «Guardar» / «Cancelar» (también Enter / Esc), motivo cuando corresponde, validación y confirmación «Guardado».
 * Si el trabajo está bloqueado (cerrado, decidido por Calidad…), se muestra un candado y la tarjeta explica por qué.
 */
function PlanField({ item, field, value, display, cells, className, inputType = "text", testId, options, label }: {
  item: WorkItem;
  field: WorkItemCellField;
  value: string;
  display?: React.ReactNode;
  cells: CellEditing;
  className?: string;
  inputType?: "text" | "date" | "number";
  testId?: string;
  /** Si se pasa, el editor es una lista (p. ej. responsable / línea). */
  options?: string[];
  label?: string;
}) {
  const spec = cells.canEditCells ? cells.edit(field) : undefined;
  const lock = spec ? spec.protection?.(item) ?? null : "Solo lectura";
  const needsReason = workItemReasonRequired(item, field, todayIso());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [reason, setReason] = useState("");
  const [askReason, setAskReason] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const showReason = askReason || needsReason;

  const cancel = () => { setEditing(false); setAskReason(false); setError(null); setDraft(value); setReason(""); };
  const save = async () => {
    const next = draft.trim();
    if (next === value.trim()) { cancel(); return; }
    const invalid = spec?.validate?.(next, item);
    if (invalid) { setError(invalid); return; }
    const why = reason.trim();
    if (showReason && why.length < MIN_WORK_ITEM_REASON) { setAskReason(true); setError(`Escribí el motivo (mín. ${MIN_WORK_ITEM_REASON} caracteres): queda auditado.`); return; }
    setBusy(true);
    setError(null);
    const res = await cells.onCellsCommit!([
      { rowId: item.id, columnKey: field, columnTitle: label ?? field, rowLabel: item.product ?? item.id, oldValue: value, newValue: next, rowVersion: String(item.version ?? ""), reason: showReason ? why : undefined },
    ]);
    setBusy(false);
    if (res.ok) {
      cancel();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      return;
    }
    const msg = res.failures?.[0]?.message ?? res.message ?? "No se guardó.";
    // El servidor es la autoridad: si exige motivo (p. ej. fecha pasada según su reloj), se pide acá.
    if (!showReason && /motivo/i.test(msg)) { setAskReason(true); setError("Esta edición requiere un motivo."); return; }
    setError(msg);
  };

  if (!cells.canEditCells || lock) {
    return (
      <div className={`${className ?? ""} ${cells.canEditCells ? "inline-flex items-center gap-1" : ""}`} data-testid={testId} data-locked={cells.canEditCells ? "1" : undefined} title={cells.canEditCells && lock ? lock : undefined}>
        {display ?? (value || "—")}
        {cells.canEditCells && <Lock className="size-3 shrink-0 text-[#8fb3c9]/70" aria-label={lock ?? "Bloqueado"} />}
      </div>
    );
  }
  if (!editing) {
    return (
      <button
        type="button"
        className={`${className ?? ""} group -mx-1 inline-flex max-w-full items-center gap-1.5 rounded px-1 text-left decoration-[var(--os-teal)]/60 decoration-dashed underline-offset-4 hover:bg-white/5 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--os-teal)]`}
        onClick={(e) => { e.stopPropagation(); setDraft(value); setEditing(true); setTimeout(() => inputRef.current?.focus(), 0); }}
        title={`Editar ${label ?? "dato"} (Producción)${needsReason ? " · requiere motivo" : ""}`}
        aria-label={`Editar ${label ?? field}`}
        data-testid={testId}
        data-editable="1"
      >
        <span className="min-w-0">{display ?? (value || "—")}</span>
        <Pencil className="size-3 shrink-0 text-[var(--os-teal)] opacity-60 group-hover:opacity-100" aria-hidden="true" />
        {saved && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-300" role="status" data-testid="card-field-saved"><Check className="size-3" aria-hidden="true" />Guardado</span>}
      </button>
    );
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); void save(); }
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
  };
  const inputClass = "w-full rounded-md border border-[var(--os-teal)] bg-[#0b2236] px-2 py-1.5 text-sm text-[var(--os-text)]";
  return (
    <div className="space-y-1.5 rounded-lg border border-[var(--os-teal)]/40 bg-[#0b2236]/80 p-2" onClick={(e) => e.stopPropagation()} data-testid="card-field-editor">
      {label && <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--os-teal)]">Editar {label}</div>}
      {options ? (
        <select ref={(el) => { inputRef.current = el; }} value={draft} disabled={busy} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} className={inputClass} data-testid="card-field-input" aria-label={`Editar ${label ?? field}`}>
          {!options.includes(draft) && <option value={draft}>{draft || "—"}</option>}
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          ref={(el) => { inputRef.current = el; }}
          type={inputType === "number" ? "text" : inputType}
          inputMode={inputType === "number" ? "decimal" : undefined}
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          className={inputClass}
          data-testid="card-field-input"
          aria-label={`Editar ${label ?? field}`}
        />
      )}
      {showReason && (
        <input
          value={reason}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Motivo (obligatorio, mín. ${MIN_WORK_ITEM_REASON} caracteres)`}
          className="w-full rounded-md border border-amber-300/50 bg-[#0b2236] px-2 py-1 text-xs text-[var(--os-text)]"
          data-testid="card-field-reason"
          aria-label="Motivo de la corrección"
        />
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-1 rounded-md bg-[var(--os-teal)] px-2.5 py-1 text-xs font-bold text-[#04201e] disabled:opacity-50" data-testid="card-field-save">
          <Check className="size-3.5" aria-hidden="true" /> {busy ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" disabled={busy} onClick={cancel} className="inline-flex items-center gap-1 rounded-md border border-white/20 px-2.5 py-1 text-xs font-semibold text-[#e6f0f6] hover:bg-white/5" data-testid="card-field-cancel">
          <X className="size-3.5" aria-hidden="true" /> Cancelar
        </button>
        <span className="text-[10px] text-[var(--os-text-muted)]">Enter guarda · Esc cancela</span>
      </div>
      {error && <p className="text-xs text-red-300" role="alert" data-testid="card-field-error">{error}</p>}
    </div>
  );
}

/** Prioridad del trabajo: la de su tarea de Semanas. Producción la cambia acá (misma tabla y API que Semanas). */
function CardPriority({ item, canEdit }: { item: WorkItem; canEdit: boolean }) {
  const p = useWorkItemSemanasPriority(item.id);
  const available = useWorkItemPrioritiesAvailable();
  if (!available) return null;
  if (!p) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <WorkItemPriorityBadge itemId={item.id} />
        {canEdit && (isPlanSector(item.sector) ? <LinkTaskPicker item={item} /> : <LinkInSemanas />)}
      </span>
    );
  }
  return canEdit ? <EditablePriority item={item} /> : <WorkItemPriorityBadge itemId={item.id} />;
}

function LinkInSemanas() {
  const { navigateSidebar } = usePreviewContext();
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); navigateSidebar("semanas_planilla"); }} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--os-teal)] hover:underline" data-testid="card-link-semanas" title="La prioridad se asigna a una tarea de Semanas: vinculá este trabajo desde Semanas → Lista.">
      <Link2 className="size-3" aria-hidden="true" /> Vincular en Semanas
    </button>
  );
}

const foldText = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const words = (t: string) => new Set(foldText(t).split(/[^a-z0-9]+/).filter((w) => w.length > 2));
function mondayOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Trabajo SIN vínculo: «Asignar prioridad» abre las tareas de Semanas de su sector y semana para que Producción ELIJA
 * la que corresponde (ordenadas por día y parecido, nunca se vincula sola). Al elegir se crea el vínculo explícito
 * (misma API y validaciones que Semanas → Lista) y desde ahí la prioridad se edita en la tarjeta.
 */
function LinkTaskPicker({ item }: { item: WorkItem }) {
  const reload = useReloadWorkItemPriorities();
  const workspace = useRequiredWorkspace();
  const { email, sectorId } = usePreviewSession();
  const session = { email: email ?? workspace.context.email, sector: sectorId ?? workspace.context.sectorId };
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<PlanTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = async () => {
    setOpen(true);
    setError(null);
    try {
      const plan = await fetchSectorPlan(session, item.sector as PlanSector);
      const week = item.plannedDate ? mondayOf(item.plannedDate) : null;
      const mine = words(`${item.product ?? ""} ${item.client ?? ""}`);
      const score = (t: PlanTask) => [...words(`${t.products.join(" ")} ${t.client ?? ""}`)].filter((w) => mine.has(w)).length;
      setTasks(
        plan.tasks
          .filter((t) => t.sector === item.sector && (!week || t.weekStart === week))
          .sort((a, b) => Number(b.date === item.plannedDate) - Number(a.date === item.plannedDate) || score(b) - score(a) || String(a.date).localeCompare(String(b.date)))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer Semanas.");
    }
  };
  const choose = async (t: PlanTask) => {
    setBusyKey(t.key);
    setError(null);
    try {
      await postTaskLink(session, { tabKey: t.tabKey, taskKey: t.key, workItemId: item.id });
      await reload();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo vincular.");
    } finally {
      setBusyKey(null);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={(e) => { e.stopPropagation(); void load(); }} className="inline-flex items-center gap-1 rounded-full border border-[var(--os-teal)]/50 px-2 py-0.5 text-[11px] font-semibold text-[var(--os-teal)] hover:bg-[var(--os-teal)]/10" data-testid="card-priority-assign" title="La prioridad es la de su tarea de Semanas: elegí la tarea para vincularlo.">
        <Pencil className="size-3" aria-hidden="true" /> Asignar prioridad
      </button>
    );
  }
  return (
    <div className="mt-1 w-full space-y-1.5 rounded-lg border border-[var(--os-teal)]/40 bg-[#0b2236] p-2 text-[12px]" onClick={(e) => e.stopPropagation()} data-testid="card-priority-picker">
      <p className="font-semibold text-[#e6f0f6]">¿Qué tarea de Semanas es este trabajo?</p>
      <p className="text-[11px] text-[var(--os-text-muted)]">Elegí la tarea: el trabajo toma su prioridad (no se vincula solo por parecido).</p>
      {!tasks && !error && <p className="text-[11px] text-[var(--os-text-muted)]">Cargando tareas de la semana…</p>}
      {tasks && tasks.length === 0 && <p className="text-[11px] text-amber-200">No hay tareas de este sector en esa semana de Semanas.</p>}
      <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
        {(tasks ?? []).slice(0, 30).map((t) => (
          <li key={t.key}>
            <button type="button" disabled={busyKey !== null} onClick={() => void choose(t)} className="flex w-full items-start justify-between gap-2 rounded-md border border-white/10 px-2 py-1.5 text-left hover:border-[var(--os-teal)]/60 hover:bg-white/5 disabled:opacity-50" data-testid="card-priority-task">
              <span className="min-w-0">
                <span className="block truncate font-semibold text-white">{t.products.join(" / ") || t.lines[0]?.value || "Tarea"}</span>
                <span className="block truncate text-[11px] text-[var(--os-text-muted)]">{t.date ? formatDay(t.date) : "Sin fecha"}{t.client ? ` · ${t.client}` : ""}{t.quantities.length ? ` · ${t.quantities.join(" / ")}` : ""}{t.assignee ? ` · ${t.assignee.value}` : ""}</span>
              </span>
              <PriorityTag priority={t.priority} />
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="text-xs text-red-300" role="alert">{error}</p>}
      <button type="button" onClick={() => setOpen(false)} className="inline-flex items-center gap-1 rounded-md border border-white/20 px-2 py-0.5 text-[11px] font-semibold text-[#e6f0f6]" data-testid="card-priority-picker-cancel">
        <X className="size-3" aria-hidden="true" /> Cancelar
      </button>
    </div>
  );
}

function EditablePriority({ item }: { item: WorkItem }) {
  const p = useWorkItemSemanasPriority(item.id)!;
  const reload = useReloadWorkItemPriorities();
  const workspace = useRequiredWorkspace();
  const { email, sectorId } = usePreviewSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = p.priorityInfo ? `${p.priorityInfo.updatedByName || p.priorityInfo.updatedBy} · ${new Date(p.priorityInfo.updatedAt).toLocaleString("es-AR")}` : "Prioridad inicial (NORMAL)";
  return (
    <span className="inline-flex flex-col items-start" data-testid="work-item-priority" data-priority={p.priority} onClick={(e) => e.stopPropagation()}>
      <PriorityChip
        priority={p.priority}
        readOnlyReason={null}
        busy={busy}
        info={`${info} · se cambia también en Semanas`}
        onChange={async (next: Priority) => {
          setBusy(true);
          setError(null);
          try {
            await patchTaskPriority({ email: email ?? workspace.context.email, sector: sectorId ?? workspace.context.sectorId }, { tabKey: p.tabKey, taskKey: p.taskKey, priority: next, expectedVersion: p.priorityInfo?.version ?? 0 });
          } catch (e) {
            setError(e instanceof Error ? e.message : "No se guardó la prioridad.");
          } finally {
            await reload();
            setBusy(false);
          }
        }}
      />
      {error && <span className="mt-1 text-xs text-red-300" role="alert">{error}</span>}
    </span>
  );
}

/** Diferencias con la tarea vinculada (solo Producción): se avisan, no se sincronizan solas. */
function SemanasDivergence({ item }: { item: WorkItem }) {
  const p = useWorkItemSemanasPriority(item.id);
  const diffs = useMemo(() => (p ? planDivergences({ plannedDate: item.plannedDate ?? null, plannedQuantity: item.quantity ?? null }, p, (d) => formatDay(d)) : []), [p, item.plannedDate, item.quantity]);
  if (!p) return null;
  if (diffs.length === 0) {
    return (
      <p className="flex items-center gap-1 text-[11px] text-[var(--os-text-muted)]" data-testid="card-semanas-ok" title={`Tarea en Semanas: ${p.taskProducts.join(" / ")}`}>
        <Link2 className="size-3 text-[var(--os-teal)]" aria-hidden="true" /> Vinculado a Semanas: {formatDay(p.taskDate)} · {p.taskProducts.join(" / ")}
      </p>
    );
  }
  return (
    <div className="rounded-md border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-[11px] text-amber-100" data-testid="card-semanas-diff" role="status">
      <p className="flex items-center gap-1 font-semibold"><AlertTriangle className="size-3" aria-hidden="true" /> Difiere de Semanas (no se sincroniza solo)</p>
      {diffs.map((d) => (
        <p key={d.field}>{d.label} en Semanas: <b>{d.semanas}</b></p>
      ))}
    </div>
  );
}

function WorkItemCard(props: WorkItemCardsProps & { item: WorkItem }) {
  const { item, variant, getFinishedQty, getObservation, onSelectItem, listMode, onArchiveFromView, onRestoreToView, archiveBusyId, showPackagingColumns, cells } = props;
  const semanas = useWorkItemSemanasPriority(item.id);
  const isProduccion = Boolean(cells.canEditCells);
  const transferred = isWorkTransferredStatus(item.status);
  // Planificación nativa: la base es la autoridad (incluye correcciones de Producción); el progreso local es solo respaldo.
  const finished = isNativeWorkItemId(item.id) ? (item.finishedQty ?? getFinishedQty(item.id)) : getFinishedQty(item.id);
  const observation = getObservation(item.id);
  const diff = variant === "envasado" ? formatOperationalDifference(item.quantity, finished) : "";
  const assigneeLabel = variant === "envasado" ? "Línea" : "Responsable";
  const assignee = variant === "envasado" ? (item.line ?? "") : (item.ownerPerson ?? "");
  const archived = listMode === "archived";
  const busy = archiveBusyId === item.id;
  // Bloqueo de planificación (mismo que aplica el servidor): se dice en la tarjeta, no solo al pasar el mouse.
  const lock = isProduccion ? (cells.edit("client").protection?.(item) ?? null) : null;
  const reported = isProduccion && !lock && isWorkItemReported(item);
  const showLote = showPackagingColumns || (isProduccion && variant === "envasado");
  return (
    <article
      data-testid="work-item-card"
      data-item-id={item.id}
      data-semanas-priority={semanas?.priority ?? "NONE"}
      className={`flex flex-col gap-2 rounded-xl border p-3.5 shadow-[0_6px_18px_-12px_rgba(0,0,0,0.7)] ${transferred ? "border-[var(--os-teal)]/40 bg-[#0f2f3a]" : "border-white/10 bg-[#10304a]"}`}
      style={priorityEdge(semanas?.priority, 5)}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <CardPriority item={item} canEdit={isProduccion} />
        <div className="flex items-center gap-1.5">
          <StatusChip status={item.status} />
        </div>
      </div>

      {lock && (
        <p className="flex items-start gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-[#cfe0ea]" data-testid="card-lock-reason">
          <Lock className="mt-0.5 size-3 shrink-0" aria-hidden="true" /> {lock}
        </p>
      )}
      {reported && (
        <p className="flex items-start gap-1.5 rounded-md border border-amber-300/25 bg-amber-300/5 px-2 py-1 text-[11px] text-amber-100" data-testid="card-reported-note">
          <Pencil className="mt-0.5 size-3 shrink-0" aria-hidden="true" /> El sector ya informó este trabajo: podés corregirlo indicando el motivo (queda auditado).
        </p>
      )}
      <div>
        <div className={LABEL}>Producto</div>
        <PlanField item={item} field="product" label="producto" value={item.product ?? ""} cells={cells} className="text-[16px] font-bold leading-snug text-white" testId="card-product" />
      </div>

      <div className="flex flex-wrap items-end gap-x-5 gap-y-1">
        <div>
          <div className={LABEL}>Cantidad planificada</div>
          <PlanField item={item} field="plannedQuantity" label="cantidad planificada" inputType="number" value={item.quantity ?? ""} display={plannedQuantityLabel(item.quantity, item.unit)} cells={cells} className="text-[17px] font-extrabold tabular-nums text-[#5eead4]" testId="card-quantity" />
        </div>
        {isProduccion && (
          <div>
            <div className={LABEL}>Unidad</div>
            <PlanField item={item} field="unit" label="unidad" value={item.unit ?? ""} cells={cells} className="text-[13px] font-semibold text-[#e6f0f6]" testId="card-unit" />
          </div>
        )}
        <div>
          <div className={LABEL}>{variant === "envasado" ? "Realizadas" : "Kg realizados"}</div>
          {/* Producción: CORRECCIÓN autorizada (motivo obligatorio, auditada). No es un avance ni borra los avances. */}
          <PlanField item={item} field="finishedQty" label="cantidad realizada (corrección)" inputType="number" value={finished} display={finished || "—"} cells={cells} className="text-[15px] font-bold tabular-nums text-[#e6f0f6]" testId="card-finished" />
        </div>
        {variant === "envasado" && diff && diff !== "—" && (
          <div>
            <div className={LABEL}>Diferencia</div>
            <div className={`text-[15px] font-bold tabular-nums ${diff.startsWith("+") ? "text-emerald-300" : diff.startsWith("-") ? "text-rose-300" : "text-[#e6f0f6]"}`}>{diff}</div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-x-3 gap-y-1.5 border-t border-white/10 pt-2 text-[13px] font-semibold text-[#e6f0f6]">
        <div>
          <div className={LABEL}>Fecha</div>
          <PlanField item={item} field="plannedDate" label="fecha de producción" value={item.plannedDate ?? ""} display={<span className="inline-flex items-center gap-1"><CalendarDays className="size-3.5 opacity-70" aria-hidden="true" />{item.plannedDate ? formatDay(item.plannedDate) : displayField(item.dayLabel)}</span>} cells={cells} inputType="date" testId="card-date" />
        </div>
        <div>
          <div className={LABEL}>{assigneeLabel}</div>
          <PlanField item={item} field="assignee" label={assigneeLabel.toLowerCase()} value={assignee} options={assigneeOptions(item, variant)} cells={cells} testId="card-assignee" />
        </div>
        <div>
          <div className={LABEL}>Cliente</div>
          <PlanField item={item} field="client" label="cliente" value={item.client ?? ""} cells={cells} testId="card-client" />
        </div>
        <div>
          <div className={LABEL}>Entrega</div>
          {isProduccion ? (
            <PlanField item={item} field="deliveryDate" label="fecha de entrega" value={item.deliveryDate ?? ""} display={item.deliveryDate ? formatDateDisplay(item.deliveryDate) : "—"} cells={cells} inputType="date" testId="card-delivery" />
          ) : (
            <DeliveryDateBadge deliveryDate={item.deliveryDate} />
          )}
        </div>
        {showLote && (
          <>
            <div>
              <div className={LABEL}>Lote</div>
              <PlanField item={item} field="packagingLote" label="lote" value={item.packagingLote ?? ""} display={displayField(item.packagingLote ?? item.loteRef)} cells={cells} testId="card-lote" />
            </div>
            <div>
              <div className={LABEL}>VTO</div>
              <PlanField item={item} field="packagingVto" label="vencimiento" inputType="date" value={item.packagingVto ?? ""} display={item.packagingVto ? formatDateDisplay(item.packagingVto) : "—"} cells={cells} testId="card-vto" />
            </div>
            <div><div className={LABEL}>OA</div>{displayField(item.oaRef)}</div>
          </>
        )}
      </div>

      {(isProduccion || item.notes) && (
        <div className="text-[12px] text-[#cfe0ea]">
          <div className={LABEL}>Observación de planificación</div>
          <PlanField item={item} field="notes" label="observación" value={item.notes ?? ""} cells={cells} testId="card-notes" />
        </div>
      )}
      {(observation || item.reworkRequestedAt) && (
        <div className="text-[12px] text-[#cfe0ea]">
          <div className={LABEL}>Avance informado</div>
          {item.reworkRequestedAt && <p className="font-semibold text-amber-200">Rehacer: {item.reworkReason || "Sin motivo informado"}</p>}
          {observation && <p>{observation}</p>}
        </div>
      )}
      {isProduccion && <SemanasDivergence item={item} />}
      <div onClick={(e) => e.stopPropagation()}>
        <WorkItemWarningBadge item={item} onSelectField={() => onSelectItem(item)} />
      </div>
      {transferred && <p className="text-xs font-semibold text-[var(--os-teal)]">{WORK_TRANSFER.deliveredToQuality}</p>}

      {!props.hideActions && <div className="mt-auto flex flex-wrap gap-1.5 border-t border-white/10 pt-2">
        <ActionButton label={archived || transferred ? "Ver detalle" : "Ver / Registrar avance"} variant="neutral" onClick={() => onSelectItem(item)} />
        {/* Mismas condiciones que la lista clásica (solo Envasado archiva/restaura de su vista). */}
        {variant === "envasado" && listMode === "active" && transferred && onArchiveFromView && (
          <ActionButton label="Archivar de mi vista" variant="neutral" disabled={busy} title={VIEW_ARCHIVE_TOOLTIP} onClick={() => onArchiveFromView(item)} />
        )}
        {variant === "envasado" && archived && onRestoreToView && (
          <ActionButton label="Restaurar a mi vista" variant="approve" disabled={busy} onClick={() => onRestoreToView(item)} />
        )}
      </div>}
    </article>
  );
}

export function WorkItemCards(props: WorkItemCardsProps) {
  return (
    <div className={props.hideActions ? "grid gap-3" : "grid gap-3 sm:grid-cols-2 2xl:grid-cols-3"} data-testid="work-item-cards">
      {props.items.map((item) => (
        <WorkItemCard key={item.id} {...props} item={item} />
      ))}
    </div>
  );
}

export { PriorityTag };
