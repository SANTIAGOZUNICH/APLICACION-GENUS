"use client";

import { useMemo, useState } from "react";
import { Archive, MoreVertical, RotateCcw, Ban, Trash2, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LifecycleAction, LifecycleDecision, DeletionImpact } from "@/lib/lifecycle";
import { LifecycleConfirmDialog } from "./lifecycle-confirm-dialog";

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
  entityLabel?: string;
  entityStatus?: string;
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
  entityLabel,
  entityStatus,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<LifecycleMenuItem | null>(null);

  const visible = useMemo(
    () => items.filter((i) => i.decision.allowed && i.decision.action !== "bloquear"),
    [items]
  );

  if (visible.length === 0) return null;

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
            className={`absolute z-50 mt-1 min-w-[11rem] max-w-[min(16rem,calc(100vw-24px))] rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-md ${
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

      <LifecycleConfirmDialog
        pending={pending}
        entityLabel={entityLabel}
        entityStatus={entityStatus}
        forceReason={
          pending?.action === "eliminar" ||
          pending?.action === "anular" ||
          pending?.action === "archivar" ||
          pending?.action === "eliminar_definitivo"
        }
        onClose={() => setPending(null)}
        onConfirm={async (reason) => {
          if (!pending) return;
          await onAction(pending.action, reason);
        }}
      />
    </div>
  );
}
