"use client";

import { Button } from "@/components/ui/button";
import { selectedCountLabel, type BulkSelection } from "./use-bulk-selection";

interface Props {
  selection: BulkSelection;
  /** Texto del alcance, p. ej. «de los 12 pendientes visibles». Nunca se asume «todos los resultados». */
  scopeLabel: string;
  onDelete?: () => void;
  /** Si el usuario no tiene permiso de eliminar, no se muestra la acción. */
  canDelete?: boolean;
  busy?: boolean;
}

/** Barra de acciones masivas: aparece solo cuando hay filas seleccionadas. */
export function BulkSelectionBar({ selection, scopeLabel, onDelete, canDelete = true, busy }: Props) {
  if (selection.count === 0) return null;
  return (
    <div
      className="sticky top-0 z-10 mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded border border-[var(--genus-primary,#1f6f4a)] bg-[var(--genus-primary-soft,#e8f3ec)] px-3 py-2 text-sm"
      role="region"
      aria-label="Acciones masivas"
      data-testid="bulk-bar"
    >
      <span className="font-medium" data-testid="bulk-count" aria-live="polite">
        {selectedCountLabel(selection.count)}
      </span>
      <span className="text-xs text-[var(--os-text-muted)]" data-testid="bulk-scope">
        {scopeLabel}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={selection.clear} disabled={busy} data-testid="bulk-clear">
          Deseleccionar
        </Button>
        {canDelete && onDelete ? (
          <Button size="sm" variant="destructive" onClick={onDelete} disabled={busy} data-testid="bulk-delete">
            Eliminar seleccionados ({selection.count})
          </Button>
        ) : null}
      </div>
    </div>
  );
}
