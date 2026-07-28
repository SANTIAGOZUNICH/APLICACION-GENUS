"use client";

import { useMemo, useState } from "react";
import { Archive, MoreVertical, RotateCcw, Ban, Trash2, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { LifecycleAction, LifecycleDecision, DeletionImpact } from "@/lib/lifecycle";

export type LifecycleMenuItem = {
  action: LifecycleAction;
  label: string;
  decision: LifecycleDecision;
  impact?: DeletionImpact;
};

type Props = {
  items: LifecycleMenuItem[];
  onAction: (action: LifecycleAction, reason: string) => void | Promise<void>;
  disabled?: boolean;
  align?: "left" | "right";
};

const ACTION_CLASS: Partial<Record<LifecycleAction, string>> = {
  eliminar: "text-rose-700",
  eliminar_definitivo: "text-rose-800",
  anular: "text-amber-700",
  archivar: "text-slate-600",
  restaurar: "text-teal-700",
  descartar_bandeja: "text-slate-600",
};

const ACTION_ICON: Partial<Record<LifecycleAction, typeof Trash2>> = {
  eliminar: Trash2,
  eliminar_definitivo: Eraser,
  anular: Ban,
  archivar: Archive,
  restaurar: RotateCcw,
};

/**
 * Menú Acciones (tres puntos) Industrial Glass — rojo solo en ítems destructivos.
 */
export function LifecycleActionsMenu({
  items,
  onAction,
  disabled,
  align = "right",
}: Props) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<LifecycleMenuItem | null>(null);
  const [reason, setReason] = useState("");
  const [confirm2, setConfirm2] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(
    () => items.filter((i) => i.decision.allowed && i.decision.action !== "bloquear"),
    [items]
  );

  if (visible.length === 0) return null;

  const closeConfirm = () => {
    setPending(null);
    setReason("");
    setConfirm2(false);
    setError(null);
  };

  const run = async () => {
    if (!pending) return;
    if (pending.decision.requireReason && !reason.trim()) {
      setError("El motivo es obligatorio.");
      return;
    }
    if (pending.decision.requireDoubleConfirm && !confirm2) {
      setError("Confirmá nuevamente la eliminación definitiva.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onAction(pending.action, reason.trim());
      closeConfirm();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la acción.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative inline-flex">
      <Button
        type="button"
        variant="tertiary"
        size="sm"
        className="size-8 p-0 text-[var(--muted-foreground)]"
        disabled={disabled}
        aria-label="Acciones"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreVertical className="size-4" />
      </Button>
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Cerrar menú"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className={`absolute z-50 mt-1 min-w-[11rem] rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-md ${
              align === "right" ? "right-0" : "left-0"
            }`}
          >
            {visible.map((item) => {
              const Icon = ACTION_ICON[item.action] ?? MoreVertical;
              return (
                <button
                  key={item.action}
                  type="button"
                  role="menuitem"
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--muted)] ${
                    ACTION_CLASS[item.action] ?? ""
                  }`}
                  onClick={() => {
                    setPending(item);
                    setReason("");
                    setConfirm2(false);
                    setError(null);
                    setOpen(false);
                  }}
                >
                  <Icon className="size-3.5 shrink-0" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </>
      )}

      <Dialog open={Boolean(pending)} onOpenChange={(v) => !v && closeConfirm()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pending?.label ?? "Confirmar"}
            </DialogTitle>
            <DialogDescription>
              {pending?.decision.reason}
              {pending?.impact?.summary ? (
                <span className="mt-2 block text-[var(--foreground)]">
                  {pending.impact.summary}
                </span>
              ) : null}
              {pending?.impact?.stockReversals?.length ? (
                <span className="mt-2 block text-amber-800">
                  Esta acción revertirá{" "}
                  {pending.impact.stockReversals
                    .map(
                      (s) =>
                        `${Math.abs(s.quantityKg)} ${s.unit ?? "kg"} de ${s.codigo}`
                    )
                    .join(", ")}
                  .
                </span>
              ) : null}
              {pending?.impact?.warnings?.map((w) => (
                <span key={w} className="mt-1 block text-amber-700">
                  {w}
                </span>
              ))}
            </DialogDescription>
          </DialogHeader>
          {pending?.decision.requireReason && (
            <label className="block text-sm">
              Motivo *
              <textarea
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Describí el motivo…"
              />
            </label>
          )}
          {pending?.decision.requireDoubleConfirm && (
            <label className="flex items-start gap-2 text-sm text-rose-800">
              <input
                type="checkbox"
                className="mt-1"
                checked={confirm2}
                onChange={(e) => setConfirm2(e.target.checked)}
              />
              Confirmo que quiero eliminar definitivamente este registro.
            </label>
          )}
          {error && (
            <p className="text-sm text-rose-700" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={closeConfirm} disabled={busy}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant={
                pending?.action === "eliminar" || pending?.action === "eliminar_definitivo"
                  ? "destructive"
                  : "primary"
              }
              onClick={() => void run()}
              disabled={busy}
            >
              {busy ? "Procesando…" : pending?.label ?? "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
