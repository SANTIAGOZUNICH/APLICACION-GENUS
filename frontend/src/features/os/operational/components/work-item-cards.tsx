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
import { AlertTriangle, CalendarDays, Link2 } from "lucide-react";
import { displayField } from "@/lib/operational/display-fields";
import { formatDay } from "@/lib/semanas-sheet/plan-tasks";
import { patchTaskPriority } from "@/lib/semanas-sheet/semanas-client";
import type { Priority } from "@/lib/semanas-sheet/priorities";
import { planDivergences } from "@/lib/semanas-sheet/task-links";
import { MIN_WORK_ITEM_REASON, workItemReasonRequired, type WorkItemCellField } from "@/lib/planning/work-item-cell-edit";
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
}

const LABEL = "text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8fb3c9]";

/** Un campo de planificación: texto para todos; para Producción, clic → edición en el lugar (Enter guarda, Esc cancela). */
function PlanField({ item, field, value, display, cells, className, inputType = "text", testId }: {
  item: WorkItem;
  field: WorkItemCellField;
  value: string;
  display?: React.ReactNode;
  cells: CellEditing;
  className?: string;
  inputType?: "text" | "date";
  testId?: string;
}) {
  const spec = cells.canEditCells ? cells.edit(field) : undefined;
  const lock = spec ? spec.protection?.(item) ?? null : "Solo lectura";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [reason, setReason] = useState("");
  const [askReason, setAskReason] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const save = async (withReason?: string) => {
    const next = draft.trim();
    if (next === value.trim()) { setEditing(false); return; }
    const invalid = spec?.validate?.(next, item);
    if (invalid) { setError(invalid); return; }
    if (!withReason && workItemReasonRequired(item, field, todayIso())) { setAskReason(true); return; }
    setBusy(true);
    setError(null);
    const res = await cells.onCellsCommit!([
      { rowId: item.id, columnKey: field, columnTitle: field, rowLabel: item.product ?? item.id, oldValue: value, newValue: next, rowVersion: String(item.version ?? ""), reason: withReason },
    ]);
    setBusy(false);
    if (res.ok) { setEditing(false); setAskReason(false); setReason(""); return; }
    const msg = res.failures?.[0]?.message ?? res.message ?? "No se guardó.";
    // El servidor es la autoridad: si exige motivo (p. ej. fecha pasada según su reloj), se pide acá.
    if (!withReason && /motivo/i.test(msg)) { setAskReason(true); setError(null); return; }
    setError(msg);
  };

  if (!cells.canEditCells || lock) {
    return <div className={className} data-testid={testId} title={cells.canEditCells && lock ? lock : undefined}>{display ?? (value || "—")}</div>;
  }
  if (!editing) {
    return (
      <button
        type="button"
        className={`${className ?? ""} -mx-1 block w-[calc(100%+0.5rem)] rounded px-1 text-left hover:bg-white/5 hover:outline hover:outline-1 hover:outline-[var(--os-teal)]/50`}
        onClick={(e) => { e.stopPropagation(); setDraft(inputType === "date" ? value : value); setEditing(true); setTimeout(() => inputRef.current?.focus(), 0); }}
        title="Clic para editar (Producción)"
        data-testid={testId}
        data-editable="1"
      >
        {display ?? (value || "—")}
      </button>
    );
  }
  return (
    <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        type={inputType}
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); void save(askReason ? reason.trim() : undefined); }
          if (e.key === "Escape") { e.preventDefault(); setEditing(false); setAskReason(false); setError(null); setDraft(value); }
        }}
        className="w-full rounded-md border border-[var(--os-teal)] bg-[var(--os-bg)] px-2 py-1 text-sm text-[var(--os-text)]"
        data-testid="card-field-input"
        aria-label={`Editar ${field}`}
      />
      {askReason && (
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && reason.trim().length >= MIN_WORK_ITEM_REASON) void save(reason.trim()); }}
            placeholder={`Motivo (mín. ${MIN_WORK_ITEM_REASON} caracteres, queda auditado)`}
            className="min-w-0 flex-1 rounded-md border border-[var(--os-border)] bg-[var(--os-bg)] px-2 py-1 text-xs"
            data-testid="card-field-reason"
          />
          <button type="button" disabled={busy || reason.trim().length < MIN_WORK_ITEM_REASON} onClick={() => void save(reason.trim())} className="rounded-md bg-[var(--os-teal)] px-2 py-1 text-xs font-bold text-[#04201e] disabled:opacity-50" data-testid="card-field-save">
            Guardar
          </button>
        </div>
      )}
      <p className="text-[10px] text-[var(--os-text-muted)]">Enter guarda · Esc cancela</p>
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
        {canEdit && <LinkInSemanas />}
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
  const finished = getFinishedQty(item.id);
  const observation = getObservation(item.id);
  const diff = variant === "envasado" ? formatOperationalDifference(item.quantity, finished) : "";
  const assigneeLabel = variant === "envasado" ? "Línea" : "Responsable";
  const assignee = variant === "envasado" ? (item.line ?? "") : (item.ownerPerson ?? "");
  const archived = listMode === "archived";
  const busy = archiveBusyId === item.id;
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

      <div>
        <div className={LABEL}>Producto</div>
        <PlanField item={item} field="product" value={item.product ?? ""} cells={cells} className="text-[16px] font-bold leading-snug text-white" testId="card-product" />
      </div>

      <div className="flex flex-wrap items-end gap-x-5 gap-y-1">
        <div>
          <div className={LABEL}>Cantidad planificada</div>
          <PlanField item={item} field="plannedQuantity" value={item.quantity ?? ""} display={plannedQuantityLabel(item.quantity, item.unit)} cells={cells} className="text-[17px] font-extrabold tabular-nums text-[#5eead4]" testId="card-quantity" />
        </div>
        <div>
          <div className={LABEL}>{variant === "envasado" ? "Realizadas" : "Kg realizados"}</div>
          <div className="text-[15px] font-bold tabular-nums text-[#e6f0f6]" data-testid="card-finished">{finished || "—"}</div>
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
          <PlanField item={item} field="plannedDate" value={item.plannedDate ?? ""} display={<span className="inline-flex items-center gap-1"><CalendarDays className="size-3.5 opacity-70" aria-hidden="true" />{item.plannedDate ? formatDay(item.plannedDate) : displayField(item.dayLabel)}</span>} cells={cells} inputType="date" testId="card-date" />
        </div>
        <div>
          <div className={LABEL}>{assigneeLabel}</div>
          <PlanField item={item} field="assignee" value={assignee} cells={cells} testId="card-assignee" />
        </div>
        <div>
          <div className={LABEL}>Cliente</div>
          <PlanField item={item} field="client" value={item.client ?? ""} cells={cells} testId="card-client" />
        </div>
        <div>
          <div className={LABEL}>Entrega</div>
          {isProduccion ? (
            <PlanField item={item} field="deliveryDate" value={item.deliveryDate ?? ""} display={item.deliveryDate ? formatDateDisplay(item.deliveryDate) : "—"} cells={cells} inputType="date" testId="card-delivery" />
          ) : (
            <DeliveryDateBadge deliveryDate={item.deliveryDate} />
          )}
        </div>
        {showPackagingColumns && (
          <>
            <div><div className={LABEL}>Lote</div>{displayField(item.packagingLote ?? item.loteRef)}</div>
            <div><div className={LABEL}>VTO</div>{displayField(item.packagingVto)}</div>
            <div><div className={LABEL}>OA</div>{displayField(item.oaRef)}</div>
          </>
        )}
      </div>

      {(isProduccion || item.notes) && (
        <div className="text-[12px] text-[#cfe0ea]">
          <div className={LABEL}>Observación de planificación</div>
          <PlanField item={item} field="notes" value={item.notes ?? ""} cells={cells} testId="card-notes" />
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

      <div className="mt-auto flex flex-wrap gap-1.5 border-t border-white/10 pt-2">
        <ActionButton label={archived || transferred ? "Ver detalle" : "Ver / Registrar avance"} variant="neutral" onClick={() => onSelectItem(item)} />
        {/* Mismas condiciones que la lista clásica (solo Envasado archiva/restaura de su vista). */}
        {variant === "envasado" && listMode === "active" && transferred && onArchiveFromView && (
          <ActionButton label="Archivar de mi vista" variant="neutral" disabled={busy} title={VIEW_ARCHIVE_TOOLTIP} onClick={() => onArchiveFromView(item)} />
        )}
        {variant === "envasado" && archived && onRestoreToView && (
          <ActionButton label="Restaurar a mi vista" variant="approve" disabled={busy} onClick={() => onRestoreToView(item)} />
        )}
      </div>
    </article>
  );
}

export function WorkItemCards(props: WorkItemCardsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3" data-testid="work-item-cards">
      {props.items.map((item) => (
        <WorkItemCard key={item.id} {...props} item={item} />
      ))}
    </div>
  );
}

export { PriorityTag };
