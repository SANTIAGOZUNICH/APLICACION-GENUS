"use client";

/**
 * Entregas — tarjeta flotante del cliente en un día: todas sus entregas programadas con el detalle completo
 * (productos, cantidades, lote, vencimiento, sector, estados, trabajos vinculados, OA, observaciones, responsable e
 * historial). Producción/Dirección además modifican, reprograman (con motivo), cancelan (con motivo) y vinculan trabajos.
 * Cancelar una entrega PROGRAMADA no es borrar una entrega REAL: esa vive en «Entregados» y no se toca desde acá.
 */
import { useCallback, useEffect, useState } from "react";
import { CalendarClock, ChevronDown, ExternalLink, History, Link2, Link2Off, Pencil, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePreviewContext } from "@/features/os/session/preview-context";
import { fetchWorkItems } from "@/lib/api/operations-client";
import { clienteRelation, productoRelation } from "@/lib/asignacion-lotes/resolve-for-work-item";
import { longDateLabel, shortDateLabel } from "@/lib/entregas/calendar";
import { entregasApi, type DeliveryDetailResponse } from "@/lib/entregas/entregas-client";
import { MIN_ENTREGAS_REASON } from "@/lib/entregas/rules";
import {
  DELIVERY_SECTOR_LABEL,
  DELIVERY_STATUS_LABEL,
  type DeliveryDisplayStatus,
  type LinkedWork,
  type ScheduledDelivery,
  type ScheduledDeliveryItem,
  type WorkDivergence,
} from "@/lib/entregas/types";
import { friendlySaveError } from "@/lib/ui/friendly-error";
import type { WorkItem } from "@/types/operational/work-item";

const STATUS_STYLE: Record<DeliveryDisplayStatus, string> = {
  programada: "border-slate-400/50 bg-slate-400/10 text-slate-200",
  produccion_pendiente: "border-amber-400/50 bg-amber-400/10 text-amber-200",
  produccion_en_proceso: "border-sky-400/50 bg-sky-400/10 text-sky-200",
  produccion_finalizada: "border-indigo-400/50 bg-indigo-400/10 text-indigo-200",
  lista_para_entregar: "border-teal-400/60 bg-teal-400/10 text-teal-200",
  entregada: "border-emerald-400/60 bg-emerald-400/15 text-emerald-200",
  cancelada: "border-rose-400/50 bg-rose-400/10 text-rose-200",
};

export function DeliveryStatusChip({ status }: { status: DeliveryDisplayStatus }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[status]}`} data-testid="entrega-status" data-status={status}>
      {DELIVERY_STATUS_LABEL[status]}
    </span>
  );
}

const ACTION_LABEL: Record<string, string> = {
  create: "Creada",
  update: "Modificada",
  reschedule: "Reprogramada",
  cancel: "Cancelada",
  link: "Trabajo vinculado",
  unlink: "Trabajo desvinculado",
  apply_to_work: "Cambios aplicados a un trabajo",
};

const WORK_STATUS_LABEL: Record<string, string> = {
  pendiente: "Pendiente",
  en_curso: "En curso",
  bloqueado: "Bloqueado",
  completo: "Completo",
  revision: "En revisión",
  entregado: "Entregado a Calidad",
  cancelado: "Cancelado",
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="min-w-0">
    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8fb3c9]">{label}</div>
    <div className="break-words text-[13px] font-semibold text-[#e6f0f6]">{children || <span className="font-normal italic text-white/45">Pendiente</span>}</div>
  </div>
);

export interface EntregaDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: string;
  date: string;
  deliveries: ScheduledDelivery[];
  canManage: boolean;
  /** Producción puede aplicar cambios a trabajos (usa la edición por celda, solo Producción). */
  canApplyToWork: boolean;
  onEdit: (delivery: ScheduledDelivery) => void;
  /** Recarga el calendario tras un cambio. */
  onChanged: () => void | Promise<void>;
}

export function EntregaDetailDialog({ open, onOpenChange, client, date, deliveries, canManage, canApplyToWork, onEdit, onChanged }: EntregaDetailDialogProps) {
  const [details, setDetails] = useState<Record<string, DeliveryDetailResponse>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const ids = deliveries.map((d) => `${d.id}:${d.version}:${d.items.map((i) => i.updatedAt + i.works.map((w) => w.operationalStatus + w.linkId).join()).join()}`).join("|");

  const loadDetails = useCallback(async () => {
    try {
      const results = await Promise.all(deliveries.map((d) => entregasApi.detail(d.id)));
      setDetails(Object.fromEntries(results.map((r) => [r.delivery.id, r])));
      setLoadError(null);
    } catch (e) {
      setLoadError(friendlySaveError(e, "No se pudo cargar el detalle."));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  useEffect(() => {
    if (open) void loadDetails();
  }, [open, loadDetails]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[94vh] w-[min(97vw,900px)] max-w-[97vw] flex-col gap-0 overflow-hidden p-0" data-testid="entrega-detail">
        <div className="shrink-0 border-b border-[var(--os-border)] px-5 py-3">
          <DialogHeader className="space-y-1 pr-8">
            <DialogTitle data-testid="entrega-detail-client">{client}</DialogTitle>
            <DialogDescription>
              Entrega del {longDateLabel(date)} · {deliveries.length} {deliveries.length === 1 ? "entrega" : "entregas"}
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          {loadError && (
            <p role="alert" className="text-sm text-[var(--genus-error,#e85d5d)]">
              {loadError}
            </p>
          )}
          {deliveries.map((d) => (
            <DeliveryCard key={d.id} delivery={d} detail={details[d.id]} canManage={canManage} canApplyToWork={canApplyToWork} onEdit={onEdit} onChanged={async () => { await onChanged(); }} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Panel = null | "reschedule" | "cancel" | "history";

function DeliveryCard({ delivery: d, detail, canManage, canApplyToWork, onEdit, onChanged }: {
  delivery: ScheduledDelivery;
  detail?: DeliveryDetailResponse;
  canManage: boolean;
  canApplyToWork: boolean;
  onEdit: (d: ScheduledDelivery) => void;
  onChanged: () => Promise<void>;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [newDate, setNewDate] = useState(d.deliveryDate);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelled = d.state === "cancelada";

  async function run(body: Record<string, unknown>, after?: () => void) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await entregasApi.patch(d.id, { ...body, expectedVersion: d.version });
      after?.();
      setPanel(null);
      setReason("");
      await onChanged();
    } catch (e) {
      setError(friendlySaveError(e, "No se pudo guardar el cambio."));
    } finally {
      setBusy(false);
    }
  }

  const reasonOk = reason.trim().length >= MIN_ENTREGAS_REASON;

  return (
    <article className={`space-y-3 rounded-xl border p-3.5 ${cancelled ? "border-rose-400/30 bg-[#2a1f2c]" : "border-white/10 bg-[#10304a]"}`} data-testid="entrega-card" data-delivery-id={d.id}>
      <header className="flex flex-wrap items-center gap-2">
        <DeliveryStatusChip status={d.status} />
        {d.rescheduleCount > 0 && (
          <span className="rounded-full border border-amber-300/40 px-2 py-0.5 text-[11px] font-semibold text-amber-200" data-testid="entrega-reprogramada">
            Reprogramada {d.rescheduleCount} {d.rescheduleCount === 1 ? "vez" : "veces"}
          </span>
        )}
        <span className="text-xs text-[#8fb3c9]">Fecha de entrega: <b className="text-[#e6f0f6]">{shortDateLabel(d.deliveryDate)}</b></span>
        {canManage && !cancelled && (
          <div className="ml-auto flex flex-wrap gap-1.5">
            <Button type="button" size="sm" variant="secondary" onClick={() => onEdit(d)} data-testid="entrega-edit">
              <Pencil className="mr-1 size-3.5" aria-hidden="true" /> Modificar
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => { setPanel(panel === "reschedule" ? null : "reschedule"); setError(null); }} data-testid="entrega-reschedule-open">
              <CalendarClock className="mr-1 size-3.5" aria-hidden="true" /> Reprogramar
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => { setPanel(panel === "cancel" ? null : "cancel"); setError(null); }} data-testid="entrega-cancel-open">
              <XCircle className="mr-1 size-3.5" aria-hidden="true" /> Cancelar entrega
            </Button>
          </div>
        )}
      </header>

      {cancelled && (
        <p className="rounded-md border border-rose-300/30 bg-rose-300/10 px-2.5 py-1.5 text-xs text-rose-100" data-testid="entrega-cancelled-note">
          Entrega cancelada el {d.cancelledAt ? new Date(d.cancelledAt).toLocaleDateString("es-AR") : "—"} por {d.cancelledBy ?? "—"}. Motivo: {d.cancelReason ?? "—"}. Queda como historial (no se borra).
        </p>
      )}

      {panel === "reschedule" && (
        <form className="space-y-2 rounded-md border border-[var(--os-border)] p-2.5" onSubmit={(e) => { e.preventDefault(); void run({ action: "reschedule", newDate, reason }); }} data-testid="entrega-reschedule-form">
          <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
            <label className="space-y-1 text-xs text-[#8fb3c9]">
              Nueva fecha
              <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="w-full rounded border border-[var(--os-border)] bg-[var(--os-bg)] px-2 py-1 text-sm text-[var(--os-text)]" data-testid="entrega-reschedule-date" />
            </label>
            <label className="space-y-1 text-xs text-[#8fb3c9]">
              Motivo (obligatorio, queda auditado)
              <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded border border-[var(--os-border)] bg-[var(--os-bg)] px-2 py-1 text-sm text-[var(--os-text)]" data-testid="entrega-reschedule-reason" />
            </label>
          </div>
          <p className="text-[11px] text-[#8fb3c9]">Los trabajos vinculados no se modifican solos: después vas a ver qué cambió y confirmás si lo aplicás.</p>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy || !reasonOk || newDate === d.deliveryDate} data-testid="entrega-reschedule-confirm">
              {busy ? "Guardando…" : "Reprogramar"}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setPanel(null)}>Cerrar</Button>
          </div>
        </form>
      )}
      {panel === "cancel" && (
        <form className="space-y-2 rounded-md border border-rose-300/30 p-2.5" onSubmit={(e) => { e.preventDefault(); void run({ action: "cancel", reason }); }} data-testid="entrega-cancel-form">
          <label className="block space-y-1 text-xs text-[#8fb3c9]">
            Motivo de la cancelación (obligatorio, queda auditado)
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded border border-[var(--os-border)] bg-[var(--os-bg)] px-2 py-1 text-sm text-[var(--os-text)]" data-testid="entrega-cancel-reason" />
          </label>
          <p className="text-[11px] text-[#8fb3c9]">Se cancela la entrega PROGRAMADA y queda en el historial. No toca entregas reales, trabajos ni stock.</p>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy || !reasonOk} data-testid="entrega-cancel-confirm">{busy ? "Cancelando…" : "Confirmar cancelación"}</Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setPanel(null)}>Volver</Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-xs text-[var(--genus-error,#e85d5d)]" data-testid="entrega-card-error">{error}</p>
      )}

      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-3">
        <Field label="Responsable">{d.responsible}</Field>
        <div className="sm:col-span-2">
          <Field label="Observaciones">{d.notes}</Field>
        </div>
      </div>

      <div className="space-y-2.5">
        {d.items.length === 0 && <p className="text-sm text-[#8fb3c9]">Sin productos visibles para tu sector.</p>}
        {d.items.map((it) => (
          <ItemBlock key={it.id} delivery={d} item={it} detail={detail} canManage={canManage && !cancelled} canApplyToWork={canApplyToWork && !cancelled} onChanged={onChanged} />
        ))}
      </div>

      {canManage && (
      <div>
        <button type="button" onClick={() => setPanel(panel === "history" ? null : "history")} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--os-teal)] hover:underline" aria-expanded={panel === "history"} data-testid="entrega-history-toggle">
          <History className="size-3.5" aria-hidden="true" /> Historial de modificaciones
          <ChevronDown className={`size-3.5 transition ${panel === "history" ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        {panel === "history" && (
          <ul className="mt-2 space-y-1 text-xs text-[#cfe0ea]" data-testid="entrega-history">
            {(detail?.history ?? []).map((h) => (
              <li key={h.id} className="rounded border border-white/10 px-2 py-1" data-action={h.action}>
                <b>{ACTION_LABEL[h.action] ?? h.action}</b> · {new Date(h.createdAt).toLocaleString("es-AR")} · {h.actorEmail}
                <HistoryDetail action={h.action} payload={h.payload} />
              </li>
            ))}
            {!detail && <li>Cargando…</li>}
          </ul>
        )}
      </div>
      )}
    </article>
  );
}

function HistoryDetail({ action, payload }: { action: string; payload: Record<string, unknown> }) {
  const p = payload as { from?: string; to?: string; reason?: string; product?: string; fields?: Array<{ field: string; from: string; to: string }> };
  if (action === "reschedule") return <span> — {p.from ? shortDateLabel(p.from) : "—"} → {p.to ? shortDateLabel(p.to) : "—"}. Motivo: {p.reason}</span>;
  if (action === "cancel" || action === "unlink") return <span> — Motivo: {p.reason}</span>;
  if (action === "link") return <span> — {p.product}</span>;
  if (action === "apply_to_work" && p.fields) return <span> — {p.fields.map((f) => `${f.field}: ${f.from} → ${f.to}`).join("; ")}. Motivo: {p.reason}</span>;
  return null;
}

function ItemBlock({ delivery, item, detail, canManage, canApplyToWork, onChanged }: {
  delivery: ScheduledDelivery;
  item: ScheduledDeliveryItem;
  detail?: DeliveryDetailResponse;
  canManage: boolean;
  canApplyToWork: boolean;
  onChanged: () => Promise<void>;
}) {
  const [linking, setLinking] = useState(false);
  return (
    <section className="space-y-2 rounded-lg border border-white/10 bg-black/10 p-3" data-testid="entrega-item" data-item-id={item.id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8fb3c9]">Producto</div>
          <div className="break-words text-[16px] font-bold leading-snug text-white" data-testid="entrega-item-name">{item.product}</div>
        </div>
        <DeliveryStatusChip status={item.status} />
      </div>
      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-4">
        <Field label="Cantidad">{item.quantity ? <span className="text-[15px] font-extrabold text-[#5eead4]">{item.quantity}{item.unit ? ` ${item.unit}` : ""}</span> : null}</Field>
        <Field label="Sector">{item.sector ? DELIVERY_SECTOR_LABEL[item.sector] : null}</Field>
        <Field label="Producción planificada">{item.plannedProductionDate ? shortDateLabel(item.plannedProductionDate) : null}</Field>
        <Field label="Lote">{item.lot}</Field>
        <Field label="Vencimiento">{item.vto}</Field>
        <div className="sm:col-span-3"><Field label="Observaciones del producto">{item.notes}</Field></div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8fb3c9]">Trabajos vinculados ({item.works.filter((w) => !w.cancelled).length})</span>
          {canManage && (
            <button type="button" onClick={() => setLinking((v) => !v)} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--os-teal)] hover:underline" data-testid="entrega-link-open">
              <Link2 className="size-3.5" aria-hidden="true" /> Vincular trabajo existente
            </button>
          )}
        </div>
        {item.works.length === 0 && <p className="text-xs italic text-white/45">Todavía no hay trabajos asignados para este producto.</p>}
        {item.works.map((w) => (
          <WorkRow
            key={w.linkId}
            work={w}
            divergences={detail?.divergences.find((x) => x.linkId === w.linkId)?.divergences ?? []}
            deliveryId={delivery.id}
            deliveryVersion={delivery.version}
            canManage={canManage}
            canApplyToWork={canApplyToWork}
            onChanged={onChanged}
          />
        ))}
        {linking && canManage && <LinkWorkPicker delivery={delivery} item={item} onLinked={async () => { setLinking(false); await onChanged(); }} />}
      </div>
    </section>
  );
}

function WorkRow({ work: w, divergences, deliveryId, canManage, canApplyToWork, onChanged }: {
  work: LinkedWork;
  divergences: WorkDivergence[];
  deliveryId: string;
  deliveryVersion: number;
  canManage: boolean;
  canApplyToWork: boolean;
  onChanged: () => Promise<void>;
}) {
  const { openWorkItem } = usePreviewContext();
  const [mode, setMode] = useState<null | "apply" | "unlink">(null);
  const [fields, setFields] = useState<string[]>(divergences.map((d) => d.field));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonOk = reason.trim().length >= MIN_ENTREGAS_REASON;

  async function submit(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await entregasApi.patch(deliveryId, body);
      setMode(null);
      setReason("");
      await onChanged();
    } catch (e) {
      setError(friendlySaveError(e, "No se pudo aplicar el cambio."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`space-y-1.5 rounded-md border px-2.5 py-2 text-xs ${w.cancelled ? "border-white/10 opacity-60" : "border-[var(--os-teal)]/30 bg-[var(--os-teal)]/5"}`} data-testid="entrega-work" data-work-id={w.workItemId}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <b className="text-[13px] text-white">{DELIVERY_SECTOR_LABEL[w.sector as keyof typeof DELIVERY_SECTOR_LABEL] ?? w.sector}{w.line ? ` · ${w.line}` : ""}</b>
        <span>Producción: {w.plannedDate ? shortDateLabel(w.plannedDate) : "—"}{w.plannedDateTo && w.plannedDateTo !== w.plannedDate ? ` → ${shortDateLabel(w.plannedDateTo)}` : ""}</span>
        <span>Cantidad: {w.plannedQuantity ?? "—"} {w.unit ?? ""}</span>
        <span>Estado: {w.delivered ? "Entregado al cliente" : w.cancelled ? "Cancelado" : WORK_STATUS_LABEL[w.operationalStatus] ?? w.operationalStatus}{w.qualityStatus === "aprobado" ? " · Calidad aprobó" : ""}</span>
        {w.orderNumber && <span data-testid="entrega-work-oa">OA/OE: <b>{w.orderNumber}</b></span>}
        {w.packagingLote && <span>Lote {w.packagingLote}</span>}
        <span className="ml-auto flex gap-2">
          <button type="button" onClick={() => openWorkItem(`native:${w.workItemId}`)} className="inline-flex items-center gap-1 font-semibold text-[var(--os-teal)] hover:underline" data-testid="entrega-work-open">
            <ExternalLink className="size-3.5" aria-hidden="true" /> Ver trabajo
          </button>
          {canManage && !w.cancelled && (
            <button type="button" onClick={() => setMode(mode === "unlink" ? null : "unlink")} className="inline-flex items-center gap-1 text-[#cfe0ea] hover:underline" data-testid="entrega-work-unlink-open">
              <Link2Off className="size-3.5" aria-hidden="true" /> Desvincular
            </button>
          )}
        </span>
      </div>

      {divergences.length > 0 && !w.cancelled && (
        <div className="space-y-1.5 rounded border border-amber-300/40 bg-amber-300/10 px-2 py-1.5" data-testid="entrega-divergences">
          <p className="font-semibold text-amber-100">La entrega cambió después de asignar este trabajo. Diferencias:</p>
          <ul className="space-y-0.5">
            {divergences.map((d) => (
              <li key={d.field} className="flex flex-wrap items-center gap-2" data-field={d.field}>
                {canApplyToWork && mode === "apply" && (
                  <input type="checkbox" checked={fields.includes(d.field)} onChange={(e) => setFields((prev) => (e.target.checked ? [...prev, d.field] : prev.filter((f) => f !== d.field)))} aria-label={`Aplicar ${d.label}`} />
                )}
                <b>{d.label}:</b> trabajo «{d.workValue}» → entrega «{d.itemValue}»
              </li>
            ))}
          </ul>
          {canApplyToWork ? (
            mode === "apply" ? (
              <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); void submit({ action: "apply_to_work", linkId: w.linkId, fields, reason }); }} data-testid="entrega-apply-form">
                <label className="block space-y-1 text-[#8fb3c9]">
                  Motivo (obligatorio, queda auditado)
                  <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded border border-[var(--os-border)] bg-[var(--os-bg)] px-2 py-1 text-sm text-[var(--os-text)]" data-testid="entrega-apply-reason" />
                </label>
                <p className="text-[#8fb3c9]">Solo se cambia lo tildado. Nunca se tocan avances, cantidades realizadas ni datos cargados por el operario.</p>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={busy || fields.length === 0 || !reasonOk} data-testid="entrega-apply-confirm">{busy ? "Aplicando…" : "Confirmar y aplicar al trabajo"}</Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => setMode(null)}>Volver</Button>
                </div>
              </form>
            ) : (
              <Button type="button" size="sm" variant="secondary" onClick={() => { setFields(divergences.map((d) => d.field)); setMode("apply"); }} data-testid="entrega-apply-open">Revisar y aplicar al trabajo…</Button>
            )
          ) : (
            <p className="text-[#cfe0ea]">Producción decide si aplica estos cambios al trabajo.</p>
          )}
        </div>
      )}

      {mode === "unlink" && (
        <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); void submit({ action: "unlink", linkId: w.linkId, reason }); }} data-testid="entrega-unlink-form">
          <label className="block space-y-1 text-[#8fb3c9]">
            Motivo (obligatorio)
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded border border-[var(--os-border)] bg-[var(--os-bg)] px-2 py-1 text-sm text-[var(--os-text)]" data-testid="entrega-unlink-reason" />
          </label>
          <p className="text-[#8fb3c9]">Solo se quita el vínculo: el trabajo y sus avances siguen como están.</p>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy || !reasonOk} data-testid="entrega-unlink-confirm">{busy ? "Guardando…" : "Desvincular"}</Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setMode(null)}>Volver</Button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="text-[var(--genus-error,#e85d5d)]" data-testid="entrega-work-error">{error}</p>}
    </div>
  );
}

/** Trabajos de Envasado que coinciden con el cliente y producto de la entrega: Producción elige cuál vincular. */
function LinkWorkPicker({ delivery, item, onLinked }: { delivery: ScheduledDelivery; item: ScheduledDeliveryItem; onLinked: () => Promise<void> }) {
  const [works, setWorks] = useState<WorkItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sectors = item.sector ? [item.sector] : (["ENVASADO_MASIVO", "ENVASADO_PREMIUM"] as const);
        const res = await Promise.all(sectors.map((s) => fetchWorkItems(s)));
        if (cancelled) return;
        const linkedIds = new Set(delivery.items.flatMap((i) => i.works.filter((w) => !w.cancelled).map((w) => `native:${w.workItemId}`)));
        setWorks(
          res
            .flatMap((r) => r.workItems)
            .filter((w) => w.id.startsWith("native:") && !linkedIds.has(w.id))
            .filter((w) => clienteRelation(w.client ?? "", delivery.client) !== "NONE" && productoRelation({ producto: item.product, codigo: "", marca: delivery.client }, w.product ?? "") !== "NONE")
        );
      } catch (e) {
        if (!cancelled) setError(friendlySaveError(e, "No se pudieron cargar los trabajos."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [delivery, item]);

  async function link(w: WorkItem) {
    setBusy(w.id);
    setError(null);
    try {
      await entregasApi.patch(delivery.id, { action: "link", itemId: item.id, workItemId: w.id.slice("native:".length) });
      await onLinked();
    } catch (e) {
      setError(friendlySaveError(e, "No se pudo vincular."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-1.5 rounded-md border border-[var(--os-border)] p-2.5 text-xs" data-testid="entrega-link-picker">
      <p className="font-semibold">Elegí el trabajo que corresponde a «{item.product}»:</p>
      {!works && !error && <p>Buscando trabajos…</p>}
      {works && works.length === 0 && <p className="italic text-white/55">No hay trabajos sin vincular que coincidan con este cliente y producto.</p>}
      <ul className="space-y-1">
        {(works ?? []).map((w) => (
          <li key={w.id} className="flex flex-wrap items-center gap-2 rounded border border-white/10 px-2 py-1" data-testid="entrega-link-candidate">
            <span className="min-w-0 flex-1">
              <b>{w.product}</b> · {w.client} · {w.quantity} {w.unit ?? ""} · {w.plannedDate ? shortDateLabel(w.plannedDate) : "—"}{w.line ? ` · ${w.line}` : ""}
            </span>
            <button type="button" disabled={busy !== null} onClick={() => void link(w)} className="rounded border border-[var(--os-teal)]/60 px-2 py-0.5 font-semibold text-[var(--os-teal)] hover:bg-[var(--os-teal)]/10" data-testid="entrega-link-pick">
              {busy === w.id ? "Vinculando…" : "Vincular"}
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-[var(--genus-error,#e85d5d)]">{error}</p>}
    </div>
  );
}
