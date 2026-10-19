"use client";

import { Button } from "@/components/ui/button";
import { selectedCountLabel, type BulkSelection } from "./use-bulk-selection";

interface Props {
  selection: BulkSelection;
  /** Texto del alcance, p. ej. «de 12 pendientes visibles». Nunca se asume «todos los resultados». */
  scopeLabel: string;
  /** Cada acción se muestra solo si se pasa su handler (y el usuario tiene permiso para ella). */
  onDeliver?: () => void;
  onSendCodificado?: () => void;
  onDelete?: () => void;
  busy?: boolean;
}

/**
 * Barra de acciones masivas (tema oscuro GENUS): aparece solo con filas seleccionadas, es compacta y los botones
 * pasan a una segunda línea en tablets angostas (flex-wrap) sin tapar encabezados ni registros.
 */
export function BulkSelectionBar({
  selection,
  scopeLabel,
  onDeliver,
  onSendCodificado,
  onDelete,
  busy,
}: Props) {
  if (selection.count === 0) return null;
  const n = selection.count;
  return (
    <div
      className="sticky top-0 z-20 mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--os-radius)] border border-[rgb(18_191_183_/_0.45)] bg-[#0b2230] px-3 py-2 text-sm text-[var(--genus-text-primary)] shadow-[0_6px_18px_rgb(0_0_0_/_0.35)]"
      role="region"
      aria-label="Acciones masivas"
      data-testid="bulk-bar"
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span
          className="font-semibold text-[var(--genus-brand-primary)]"
          data-testid="bulk-count"
          aria-live="polite"
        >
          {selectedCountLabel(n)}
        </span>
        <span
          className="text-xs text-[var(--os-text-muted)]"
          data-testid="bulk-scope"
        >
          {scopeLabel}
        </span>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={selection.clear}
          disabled={busy}
          data-testid="bulk-clear"
          className="min-h-9"
        >
          Deseleccionar
        </Button>
        {onDeliver ? (
          <Button
            size="sm"
            variant="primary"
            onClick={onDeliver}
            disabled={busy}
            data-testid="bulk-deliver"
            className="min-h-9"
          >
            Marcar como entregados ({n})
          </Button>
        ) : null}
        {onSendCodificado ? (
          <Button
            size="sm"
            variant="primary"
            onClick={onSendCodificado}
            disabled={busy}
            data-testid="bulk-codificado"
            className="min-h-9"
          >
            Enviar a Codificado ({n})
          </Button>
        ) : null}
        {onDelete ? (
          <Button
            size="sm"
            variant="destructive"
            onClick={onDelete}
            disabled={busy}
            data-testid="bulk-delete"
            className="min-h-9"
          >
            Eliminar seleccionados ({n})
          </Button>
        ) : null}
      </div>
    </div>
  );
}
