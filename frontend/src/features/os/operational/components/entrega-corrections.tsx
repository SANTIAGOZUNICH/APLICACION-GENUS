"use client";

/**
 * Entregas — correcciones de Producción desde el calendario:
 *  - Entrega programada: restaurar si se canceló; cambiar la fecha de UN producto (los demás quedan en su fecha); quitar
 *    un producto (baja lógica con motivo) y restaurarlo.
 *  - Entrega «Desde trabajo»: editar fecha de entrega / cantidad / observaciones (se guardan en el trabajo, con su
 *    historial); quitarla del calendario (lógico, con motivo: no reaparece) y restaurarla.
 *  - Entrega REAL («Entrega registrada»): no se edita ni se borra desde acá; se corrige con la anulación auditada de Entregados.
 * Todo exige motivo y queda en el historial. Nada de esto toca stock, consumos de MP ni entregas físicas.
 */
import { useState } from "react";
import { CalendarClock, EyeOff, RotateCcw, Trash2, Pencil, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shortDateLabel } from "@/lib/entregas/calendar";
import { entregasApi } from "@/lib/entregas/entregas-client";
import { MIN_ENTREGAS_REASON } from "@/lib/entregas/rules";
import { DATE_REVIEW_LABEL, type DateReviewFlag, type ScheduledDelivery, type ScheduledDeliveryItem } from "@/lib/entregas/types";
import { friendlySaveError } from "@/lib/ui/friendly-error";

const inputCls = "w-full rounded border border-[var(--os-border)] bg-[var(--os-bg)] px-2 py-1 text-sm text-[var(--os-text)]";
const linkCls = "inline-flex items-center gap-1 text-xs font-semibold text-[var(--os-teal)] hover:underline";

/** Formulario chico con motivo obligatorio (y campos extra opcionales). */
function ReasonForm({
  testId,
  title,
  hint,
  submitLabel,
  extra,
  canSubmit = true,
  onSubmit,
  onClose,
}: {
  testId: string;
  title: string;
  hint?: string;
  submitLabel: string;
  extra?: React.ReactNode;
  canSubmit?: boolean;
  onSubmit: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = reason.trim().length >= MIN_ENTREGAS_REASON && canSubmit;
  return (
    <form
      className="space-y-2 rounded-md border border-[var(--os-border)] p-2.5"
      data-testid={`${testId}-form`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ok || busy) return;
        setBusy(true);
        setError(null);
        try {
          await onSubmit(reason.trim());
        } catch (err) {
          setError(friendlySaveError(err, "No se pudo guardar el cambio."));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-xs font-semibold text-[#e6f0f6]">{title}</p>
      {extra}
      <label className="block space-y-1 text-xs text-[#8fb3c9]">
        Motivo (obligatorio, mín. {MIN_ENTREGAS_REASON} caracteres, queda auditado)
        <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} data-testid={`${testId}-reason`} />
      </label>
      {reason.trim().length > 0 && reason.trim().length < MIN_ENTREGAS_REASON && (
        <p className="text-[11px] text-amber-300" data-testid={`${testId}-reason-short`}>
          Al motivo le faltan {MIN_ENTREGAS_REASON - reason.trim().length} caracteres.
        </p>
      )}
      {hint && <p className="text-[11px] text-[#8fb3c9]">{hint}</p>}
      {/* Error REAL del servidor (no del motivo, que ya se valida arriba). */}
      {error && <p role="alert" className="text-xs text-[var(--genus-error,#e85d5d)]" data-testid={`${testId}-error`}>No se guardó: {error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!ok || busy} data-testid={`${testId}-confirm`}>{busy ? "Guardando…" : submitLabel}</Button>
        <Button type="button" size="sm" variant="secondary" onClick={onClose}>Volver</Button>
      </div>
    </form>
  );
}

/** «Revisar fecha»: fechas contradictorias detectadas (no se corrigen solas). */
export function ReviewFlagsNote({ flags }: { flags?: DateReviewFlag[] }) {
  if (!flags?.length) return null;
  return (
    <div className="flex items-start gap-1.5 rounded border border-amber-300/40 bg-amber-300/10 px-2 py-1 text-xs text-amber-100" data-testid="entrega-review-flag" data-flags={flags.join(",")}>
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>
        <b>Revisar fecha:</b> {flags.map((f) => DATE_REVIEW_LABEL[f]).join(" ")}
      </span>
    </div>
  );
}

/** Restaurar una entrega programada cancelada. */
export function RestoreDeliveryAction({ delivery, onChanged }: { delivery: ScheduledDelivery; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)} data-testid="entrega-restore-open">
        <RotateCcw className="mr-1 size-3.5" aria-hidden="true" /> Restaurar entrega
      </Button>
    );
  }
  return (
    <ReasonForm
      testId="entrega-restore"
      title="Restaurar la entrega cancelada"
      hint="Vuelve a quedar programada con sus productos y trabajos vinculados. La cancelación queda en el historial."
      submitLabel="Restaurar"
      onClose={() => setOpen(false)}
      onSubmit={async (reason) => {
        await entregasApi.patch(delivery.id, { action: "restore", reason, expectedVersion: delivery.version });
        setOpen(false);
        await onChanged();
      }}
    />
  );
}

/** Producto de una entrega programada: cambiar SOLO su fecha o quitarlo (lógico). */
export function ScheduledItemActions({ delivery, item, onChanged }: { delivery: ScheduledDelivery; item: ScheduledDeliveryItem; onChanged: () => Promise<void> }) {
  const [mode, setMode] = useState<null | "move" | "delete">(null);
  const [date, setDate] = useState(delivery.deliveryDate);
  const activeWorks = item.works.filter((w) => !w.cancelled).length;
  const many = delivery.items.length > 1;
  return (
    <div className="space-y-1.5" data-testid="entrega-item-actions">
      <div className="flex flex-wrap gap-3">
        <button type="button" className={linkCls} onClick={() => setMode(mode === "move" ? null : "move")} data-testid="entrega-item-move-open">
          <CalendarClock className="size-3.5" aria-hidden="true" /> {many ? "Cambiar la fecha de este producto" : "Cambiar la fecha"}
        </button>
        {many && activeWorks === 0 && (
          <button type="button" className={linkCls} onClick={() => setMode(mode === "delete" ? null : "delete")} data-testid="entrega-item-delete-open">
            <Trash2 className="size-3.5" aria-hidden="true" /> Quitar producto
          </button>
        )}
      </div>
      {mode === "move" && (
        <ReasonForm
          testId="entrega-item-move"
          title={many ? `Nueva fecha para «${item.product}» (los demás productos quedan el ${shortDateLabel(delivery.deliveryDate)})` : "Nueva fecha de la entrega"}
          hint="Los trabajos vinculados acompañan al producto; si su fecha queda distinta vas a ver la diferencia para confirmarla."
          submitLabel="Cambiar fecha"
          canSubmit={/^\d{4}-\d{2}-\d{2}$/.test(date) && date !== delivery.deliveryDate}
          extra={
            <label className="block space-y-1 text-xs text-[#8fb3c9]">
              Nueva fecha
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} data-testid="entrega-item-move-date" />
            </label>
          }
          onClose={() => setMode(null)}
          onSubmit={async (reason) => {
            await entregasApi.patch(delivery.id, { action: "move_item", itemId: item.id, newDate: date, reason, expectedVersion: delivery.version });
            setMode(null);
            await onChanged();
          }}
        />
      )}
      {mode === "delete" && (
        <ReasonForm
          testId="entrega-item-delete"
          title={`Quitar «${item.product}» de esta entrega`}
          hint="Baja lógica: queda en el historial y se puede restaurar. No toca trabajos, entregas reales ni stock."
          submitLabel="Quitar producto"
          onClose={() => setMode(null)}
          onSubmit={async (reason) => {
            await entregasApi.patch(delivery.id, { action: "delete_item", itemId: item.id, reason, expectedVersion: delivery.version });
            setMode(null);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

/** Productos quitados de una entrega programada (para restaurarlos). */
export function DeletedItemsList({ delivery, items, onChanged }: { delivery: ScheduledDelivery; items: ScheduledDeliveryItem[]; onChanged: () => Promise<void> }) {
  const [restoring, setRestoring] = useState<string | null>(null);
  if (items.length === 0) return null;
  return (
    <details className="text-xs text-[#cfe0ea]" data-testid="entrega-deleted-items">
      <summary className="cursor-pointer select-none font-semibold text-[#8fb3c9]">Productos quitados ({items.length})</summary>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((it) => (
          <li key={it.id} className="space-y-1 rounded border border-white/10 px-2 py-1" data-testid="entrega-deleted-item" data-item-id={it.id}>
            <div>
              <b className="line-through">{it.product}</b> · quitado el {it.deletedAt ? new Date(it.deletedAt).toLocaleString("es-AR") : "—"} por {it.deletedBy ?? "—"}. Motivo: {it.deletedReason ?? "—"}
            </div>
            {restoring === it.id ? (
              <ReasonForm
                testId="entrega-item-restore"
                title={`Restaurar «${it.product}»`}
                submitLabel="Restaurar producto"
                onClose={() => setRestoring(null)}
                onSubmit={async (reason) => {
                  await entregasApi.patch(delivery.id, { action: "restore_item", itemId: it.id, reason });
                  setRestoring(null);
                  await onChanged();
                }}
              />
            ) : (
              delivery.state !== "cancelada" && (
                <button type="button" className={linkCls} onClick={() => setRestoring(it.id)} data-testid="entrega-item-restore-open">
                  <RotateCcw className="size-3.5" aria-hidden="true" /> Restaurar
                </button>
              )
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Entrega «Desde trabajo»: editar los datos del trabajo que la generan, quitarla del calendario o restaurarla.
 * `canEditWork`: la edición del trabajo usa la edición canónica (solo Producción).
 */
export function DerivedWorkActions({ item, canEditWork, onChanged }: { item: ScheduledDeliveryItem; canEditWork: boolean; onChanged: () => Promise<void> }) {
  const work = item.works[0];
  const [mode, setMode] = useState<null | "edit" | "hide" | "restore">(null);
  const [date, setDate] = useState(work?.deliveryDate ?? "");
  const [qty, setQty] = useState(work?.plannedQuantity ?? "");
  const [notes, setNotes] = useState(work?.notes ?? "");
  if (!work) return null;
  const hidden = item.hidden;
  const changed = date !== (work.deliveryDate ?? "") || qty !== (work.plannedQuantity ?? "") || notes !== (work.notes ?? "");
  return (
    <div className="space-y-1.5" data-testid="entrega-work-actions">
      {hidden ? (
        <p className="rounded border border-white/15 bg-white/5 px-2 py-1 text-xs text-[#cfe0ea]" data-testid="entrega-hidden-note">
          Quitada del calendario el {hidden.at ? new Date(hidden.at).toLocaleString("es-AR") : "—"} por {hidden.by}. Motivo: {hidden.reason}. No vuelve a aparecer hasta que se restaure.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {!hidden && canEditWork && (
          <button type="button" className={linkCls} onClick={() => setMode(mode === "edit" ? null : "edit")} data-testid="entrega-work-edit-open">
            <Pencil className="size-3.5" aria-hidden="true" /> Editar fecha / cantidad / observaciones
          </button>
        )}
        {!hidden && (
          <button type="button" className={linkCls} onClick={() => setMode(mode === "hide" ? null : "hide")} data-testid="entrega-work-hide-open">
            <EyeOff className="size-3.5" aria-hidden="true" /> Quitar del calendario
          </button>
        )}
        {hidden && (
          <button type="button" className={linkCls} onClick={() => setMode(mode === "restore" ? null : "restore")} data-testid="entrega-work-restore-open">
            <RotateCcw className="size-3.5" aria-hidden="true" /> Restaurar en el calendario
          </button>
        )}
      </div>
      {mode === "edit" && (
        <ReasonForm
          testId="entrega-work-edit"
          title="Editar la entrega (se guarda en el trabajo)"
          hint="Cambia solo este trabajo: los demás productos del cliente quedan en su fecha. Queda en el historial del trabajo."
          submitLabel="Guardar"
          canSubmit={changed}
          extra={
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="space-y-1 text-xs text-[#8fb3c9]">
                Fecha de entrega
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} data-testid="entrega-work-edit-date" />
              </label>
              <label className="space-y-1 text-xs text-[#8fb3c9]">
                Cantidad programada
                <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className={inputCls} data-testid="entrega-work-edit-qty" />
              </label>
              <label className="space-y-1 text-xs text-[#8fb3c9] sm:col-span-1">
                Observaciones
                <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} data-testid="entrega-work-edit-notes" />
              </label>
            </div>
          }
          onClose={() => setMode(null)}
          onSubmit={async (reason) => {
            const body: Record<string, unknown> = { action: "edit", reason };
            if (date !== (work.deliveryDate ?? "")) body.deliveryDate = date || null;
            if (qty !== (work.plannedQuantity ?? "")) body.plannedQuantity = qty || null;
            if (notes !== (work.notes ?? "")) body.notes = notes || null;
            await entregasApi.work(work.workItemId, body);
            setMode(null);
            await onChanged();
          }}
        />
      )}
      {mode === "hide" && (
        <ReasonForm
          testId="entrega-work-hide"
          title="Quitar esta entrega del calendario"
          hint="Baja lógica: el trabajo no se modifica y su fecha no vuelve a aparecer acá (se puede restaurar con «Ver quitadas»). Las entregas reales no se tocan."
          submitLabel="Quitar del calendario"
          onClose={() => setMode(null)}
          onSubmit={async (reason) => {
            await entregasApi.work(work.workItemId, { action: "hide", reason });
            setMode(null);
            await onChanged();
          }}
        />
      )}
      {mode === "restore" && (
        <ReasonForm
          testId="entrega-work-restore"
          title="Volver a mostrar esta entrega en el calendario"
          submitLabel="Restaurar"
          onClose={() => setMode(null)}
          onSubmit={async (reason) => {
            await entregasApi.work(work.workItemId, { action: "restore", reason });
            setMode(null);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}
