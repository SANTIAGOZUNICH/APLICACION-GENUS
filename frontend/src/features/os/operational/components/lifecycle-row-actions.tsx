"use client";

import { useMemo, useState } from "react";
import { Eye, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LifecycleAction } from "@/lib/lifecycle";
import {
  LifecycleActionsMenu,
  type LifecycleMenuItem,
} from "./lifecycle-actions-menu";
import { LifecycleConfirmDialog } from "./lifecycle-confirm-dialog";

const DELETE_ACTIONS: LifecycleAction[] = [
  "eliminar",
  "anular",
  "archivar",
  "eliminar_definitivo",
  "descartar_bandeja",
];

function pickPrimaryDelete(items: LifecycleMenuItem[]): LifecycleMenuItem | null {
  const allowed = items.filter(
    (i) => i.decision.allowed && i.decision.action !== "bloquear"
  );
  for (const action of DELETE_ACTIONS) {
    const hit = allowed.find((i) => i.action === action);
    if (hit) return hit;
  }
  return null;
}

export type LifecycleRowActionsProps = {
  items: LifecycleMenuItem[];
  onAction: (action: LifecycleAction, reason: string) => void | Promise<void>;
  onPrimary?: () => void;
  primaryLabel?: string;
  entityLabel?: string;
  entityStatus?: string;
  disabled?: boolean;
  /** Si false, no muestra menú ⋮ (solo Abrir + Borrar). Default true cuando hay más acciones. */
  showOverflowMenu?: boolean;
  className?: string;
};

/**
 * Acciones de fila: [Abrir] [Borrar] (+ ⋮ si hay más).
 * “Borrar” abre confirmación; la política decide eliminar/anular/archivar.
 */
export function LifecycleRowActions({
  items,
  onAction,
  onPrimary,
  primaryLabel = "Abrir",
  entityLabel,
  entityStatus,
  disabled,
  showOverflowMenu,
  className,
}: LifecycleRowActionsProps) {
  const [pending, setPending] = useState<LifecycleMenuItem | null>(null);
  const [busy, setBusy] = useState(false);

  const visible = useMemo(
    () => items.filter((i) => i.decision.allowed && i.decision.action !== "bloquear"),
    [items]
  );
  const primaryDelete = useMemo(() => pickPrimaryDelete(visible), [visible]);
  const overflowItems = useMemo(() => {
    if (!primaryDelete) return visible;
    return visible.filter((i) => i.action !== primaryDelete.action);
  }, [visible, primaryDelete]);

  const showMenu =
    showOverflowMenu ?? overflowItems.length > 0;

  if (!onPrimary && !primaryDelete && overflowItems.length === 0) return null;

  return (
    <div
      className={`flex max-w-full flex-wrap items-center gap-1 ${className ?? ""}`}
      data-testid="lifecycle-row-actions"
    >
      {onPrimary ? (
        <>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="hidden sm:inline-flex"
            disabled={disabled || busy}
            onClick={onPrimary}
            data-testid="lifecycle-row-open"
          >
            {primaryLabel}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="inline-flex size-8 p-0 sm:hidden"
            disabled={disabled || busy}
            onClick={onPrimary}
            aria-label={primaryLabel}
            title={primaryLabel}
            data-testid="lifecycle-row-open-icon"
          >
            <Eye className="size-4" />
          </Button>
        </>
      ) : null}

      {primaryDelete ? (
        <>
          <Button
            type="button"
            variant="tertiary"
            size="sm"
            className="hidden text-rose-700 hover:bg-rose-50 sm:inline-flex"
            disabled={disabled || busy}
            onClick={() => setPending(primaryDelete)}
            data-testid="lifecycle-row-delete"
          >
            <Trash2 className="size-3.5" />
            Borrar
          </Button>
          <Button
            type="button"
            variant="tertiary"
            size="sm"
            className="inline-flex size-8 p-0 text-rose-700 hover:bg-rose-50 sm:hidden"
            disabled={disabled || busy}
            onClick={() => setPending(primaryDelete)}
            aria-label="Borrar"
            title="Borrar"
            data-testid="lifecycle-row-delete-icon"
          >
            <Trash2 className="size-4" />
          </Button>
        </>
      ) : null}

      {showMenu && overflowItems.length > 0 ? (
        <LifecycleActionsMenu
          items={overflowItems}
          onAction={onAction}
          disabled={disabled || busy}
          align="right"
        />
      ) : null}

      <LifecycleConfirmDialog
        pending={pending}
        entityLabel={entityLabel}
        entityStatus={entityStatus}
        forceReason
        onClose={() => setPending(null)}
        onConfirm={async (reason) => {
          if (!pending) return;
          setBusy(true);
          try {
            await onAction(pending.action, reason);
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

export { pickPrimaryDelete };
