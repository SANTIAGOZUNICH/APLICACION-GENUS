"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  normalizeOptionalReason,
  type LifecycleAction,
} from "@/lib/lifecycle";
import type { LifecycleMenuItem } from "./lifecycle-actions-menu";

export function confirmLabelForAction(action: LifecycleAction): string {
  switch (action) {
    case "anular":
      return "Confirmar anulación";
    case "archivar":
      return "Confirmar archivado";
    case "eliminar_definitivo":
      return "Confirmar eliminación definitiva";
    case "restaurar":
      return "Confirmar restauración";
    case "descartar_bandeja":
      return "Confirmar descarte";
    case "eliminar":
    default:
      return "Confirmar eliminación";
  }
}

function busyLabelForAction(action: LifecycleAction): string {
  switch (action) {
    case "anular":
      return "Anulando…";
    case "archivar":
      return "Archivando…";
    case "restaurar":
      return "Restaurando…";
    case "eliminar":
    case "eliminar_definitivo":
    case "descartar_bandeja":
      return "Eliminando…";
    default:
      return "Procesando…";
  }
}

type LifecycleConfirmDialogProps = {
  pending: LifecycleMenuItem | null;
  entityLabel?: string;
  entityStatus?: string;
  /**
   * Muestra el campo de motivo (opcional). Ya no obliga a completarlo.
   * Conservado por compatibilidad con callers que pasaban forceReason.
   */
  forceReason?: boolean;
  /** @deprecated Motivo es siempre opcional; se ignora. */
  minReasonLength?: number;
  onConfirm: (reason: string) => void | Promise<void>;
  onClose: () => void;
};

/**
 * Confirmación central de lifecycle — motivo opcional, un solo paso, anti doble-clic.
 */
export function LifecycleConfirmDialog({
  pending,
  entityLabel,
  entityStatus,
  forceReason = false,
  onConfirm,
  onClose,
}: LifecycleConfirmDialogProps) {
  const [reason, setReason] = useState("");
  const [confirm2, setConfirm2] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showReason =
    forceReason || Boolean(pending?.decision.requireReason);
  const needDouble = Boolean(pending?.decision.requireDoubleConfirm);

  const reset = () => {
    setReason("");
    setConfirm2(false);
    setError(null);
    setBusy(false);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      if (busy) return;
      reset();
      onClose();
    }
  };

  const run = async () => {
    if (!pending || busy) return;
    if (needDouble && !confirm2) {
      setError("Confirmá nuevamente la eliminación definitiva.");
      return;
    }
    setBusy(true);
    setError(null);
    const normalized = normalizeOptionalReason(reason);
    try {
      await onConfirm(normalized);
      reset();
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo completar la acción."
      );
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(pending)} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[min(90dvh,640px)] w-[min(28rem,calc(100vw-24px))] max-w-none overflow-x-hidden overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {pending ? confirmLabelForAction(pending.action) : "Confirmar"}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm text-[var(--muted-foreground)]">
              {entityLabel ? (
                <p>
                  <span className="font-medium text-[var(--foreground)]">
                    {entityLabel}
                  </span>
                  {entityStatus ? (
                    <span className="ml-2 text-xs uppercase tracking-wide">
                      · {entityStatus}
                    </span>
                  ) : null}
                </p>
              ) : null}
              <p className="break-words">{pending?.decision.reason}</p>
              {pending?.impact?.summary ? (
                <p className="break-words text-[var(--foreground)]">
                  {pending.impact.summary}
                </p>
              ) : null}
              {pending?.impact?.stockReversals?.length ? (
                <p className="break-words text-amber-800">
                  Esta acción revertirá{" "}
                  {pending.impact.stockReversals
                    .map(
                      (s) =>
                        `${Math.abs(s.quantityKg)} ${s.unit ?? "kg"} de ${s.codigo}`
                    )
                    .join(", ")}
                  .
                </p>
              ) : null}
              {pending?.impact?.warnings?.map((w) => (
                <p key={w} className="break-words text-amber-700">
                  {w}
                </p>
              ))}
            </div>
          </DialogDescription>
        </DialogHeader>
        {showReason && (
          <label className="block min-w-0 text-sm">
            Motivo (opcional)
            <textarea
              className="mt-1 w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Podés dejarlo vacío"
              disabled={busy}
              data-testid="lifecycle-confirm-reason"
            />
            <span className="mt-1 block text-xs text-[var(--muted-foreground)]">
              Si no informás motivo, se registrará “Sin motivo informado”.
            </span>
          </label>
        )}
        {needDouble && (
          <label className="flex items-start gap-2 text-sm text-rose-800">
            <input
              type="checkbox"
              className="mt-1"
              checked={confirm2}
              onChange={(e) => setConfirm2(e.target.checked)}
              disabled={busy}
            />
            Confirmo que quiero eliminar definitivamente este registro.
          </label>
        )}
        {error && (
          <div className="space-y-2" role="alert">
            <p className="text-sm text-rose-700">{error}</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void run()}
              data-testid="lifecycle-confirm-retry"
            >
              Reintentar
            </Button>
          </div>
        )}
        <DialogFooter className="flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => handleOpenChange(false)}
            disabled={busy}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant={
              pending?.action === "eliminar" ||
              pending?.action === "eliminar_definitivo"
                ? "destructive"
                : "primary"
            }
            onClick={() => void run()}
            disabled={busy}
            data-testid="lifecycle-confirm-submit"
          >
            {busy && pending
              ? busyLabelForAction(pending.action)
              : pending
                ? confirmLabelForAction(pending.action)
                : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
