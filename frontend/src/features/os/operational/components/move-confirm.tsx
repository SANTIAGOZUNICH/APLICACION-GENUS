"use client";

/**
 * Mover un trabajo a otro día (arrastrar o elegir fecha en la tarjeta): NADA se guarda hasta CONFIRMAR. CANCELAR deja
 * la tarjeta donde estaba (la vista no se modifica de forma optimista). Sin motivo: la operación queda auditada en el
 * servidor con usuario, fecha, valor anterior y nuevo. Un solo envío aunque se haga clic varias veces.
 */
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { postRescheduleWork } from "@/lib/api/live-sync-client";
import { formatDateDisplay } from "@/features/os/operational/lib/delivery-date";
import type { SectorId } from "@/types/operational/sector";
import type { WorkItem } from "@/types/operational/work-item";

export interface PendingMove {
  item: WorkItem;
  plannedDate: string;
  /** undefined = no cambia la línea; null = sin línea (Elaboración/Codificado). */
  line?: string | null;
  lineLabel?: string;
}

export function usePendingMove(opts: {
  actorSectorId: SectorId;
  updatedBy: string;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const request = useCallback((move: PendingMove) => {
    if (inFlight.current) return;
    setPending(move);
  }, []);
  const cancel = useCallback(() => {
    if (inFlight.current) return;
    setPending(null);
  }, []);
  const confirm = useCallback(async () => {
    if (!pending || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const res = await postRescheduleWork({
        itemId: pending.item.id,
        plannedDate: pending.plannedDate,
        ...(pending.line !== undefined ? { line: pending.line } : {}),
        updatedBy: opts.updatedBy,
        actorSectorId: opts.actorSectorId,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        opts.onError(body.error ?? "No se pudo mover el trabajo. Reintentá.");
        return;
      }
      setPending(null);
      opts.onSaved();
    } catch {
      opts.onError("No se pudo mover el trabajo. Reintentá.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [pending, opts]);
  return { pending, busy, request, cancel, confirm };
}

export function MoveConfirmDialog({
  pending,
  busy,
  onConfirm,
  onCancel,
}: {
  pending: PendingMove | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!pending) return null;
  const from = pending.item.plannedDate ? formatDateDisplay(pending.item.plannedDate) : "—";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" role="presentation" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Confirmar movimiento"
        className="w-full max-w-sm rounded-xl border border-[var(--os-border)] bg-[var(--os-surface)] p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="move-confirm"
      >
        <p className="text-sm font-semibold text-[var(--os-text)]">{pending.item.product ?? "Trabajo"}</p>
        <p className="mt-1 text-sm text-[var(--os-text-muted)]">
          Mover del <b className="text-[var(--os-text)]">{from}</b> al{" "}
          <b className="text-[var(--os-text)]" data-testid="move-confirm-date">{formatDateDisplay(pending.plannedDate)}</b>
          {pending.lineLabel ? <> · {pending.lineLabel}</> : null}
        </p>
        <div className="mt-4 flex gap-2">
          <Button type="button" onClick={onConfirm} disabled={busy} data-testid="move-confirm-ok" className="flex-1">
            {busy ? "Guardando…" : "CONFIRMAR"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy} data-testid="move-confirm-cancel" className="flex-1">
            CANCELAR
          </Button>
        </div>
      </div>
    </div>
  );
}
