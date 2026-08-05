"use client";

import { useState } from "react";
import { LifecycleConfirmDialog } from "./lifecycle-confirm-dialog";
import { syntheticLifecycleItem } from "./lifecycle-synthetic";
import { bulkDeleteConfirmMessage, ListSelectionToolbar } from "./list-selection-mode";

export type BulkDeleteSummary = {
  requested: number;
  deleted: number;
  alreadyDeleted: number;
  forbidden: number;
  failed: number;
};

export type BulkDeleteActionProps = {
  selectedCount: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onCancel: () => void;
  /** Título del diálogo de confirmación (ej. "Eliminar materiales ME"). */
  title: string;
  /** Ejecuta el borrado de cada seleccionado y devuelve el resumen agregado. */
  onConfirm: (reason: string) => Promise<BulkDeleteSummary>;
  /** Se llama con el resumen una vez terminado, para mostrar un toast propio. */
  onSummary: (summary: BulkDeleteSummary) => void;
  deleteLabel?: string;
};

/**
 * Wrapper de `ListSelectionToolbar` + `LifecycleConfirmDialog` para borrado
 * masivo. El caller resuelve la eliminación registro a registro en
 * `onConfirm` y devuelve conteos; este componente solo orquesta el diálogo,
 * el estado `busy` y expone el resumen final vía `onSummary`.
 */
export function BulkDeleteAction({
  selectedCount,
  onSelectAll,
  onDeselectAll,
  onCancel,
  title,
  onConfirm,
  onSummary,
  deleteLabel = "Eliminar seleccionados",
}: BulkDeleteActionProps) {
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <ListSelectionToolbar
        selectedCount={selectedCount}
        onSelectAll={onSelectAll}
        onDeselectAll={onDeselectAll}
        onDelete={() => setPending(true)}
        onCancel={onCancel}
        busy={busy}
        deleteLabel={deleteLabel}
      />
      <LifecycleConfirmDialog
        pending={
          pending
            ? syntheticLifecycleItem("eliminar", title, bulkDeleteConfirmMessage(selectedCount))
            : null
        }
        entityLabel={`${selectedCount} registro(s)`}
        onClose={() => setPending(false)}
        onConfirm={async (reason) => {
          setBusy(true);
          try {
            const summary = await onConfirm(reason);
            onSummary(summary);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
