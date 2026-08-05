"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { LifecycleConfirmDialog } from "./lifecycle-confirm-dialog";
import { syntheticLifecycleItem } from "./lifecycle-synthetic";

export type DeleteActionProps = {
  /** Etiqueta accesible del botón (aria-label / title). */
  label?: string;
  /** Nombre de la entidad afectada, mostrado en el diálogo. */
  entityLabel: string;
  /** Título del diálogo de confirmación. */
  title: string;
  /** Explicación del impacto de la acción (revertidos, recalculo, etc). */
  description: string;
  /** Ejecuta la eliminación; lanzar para mostrar error en el diálogo. */
  onConfirm: (reason: string) => Promise<void> | void;
  disabled?: boolean;
  className?: string;
};

/**
 * Botón de papelera + `LifecycleConfirmDialog` reutilizable para filas de
 * tablas de inventario ME/MP. Motivo siempre opcional.
 */
export function DeleteAction({
  label = "Eliminar",
  entityLabel,
  title,
  description,
  onConfirm,
  disabled,
  className,
}: DeleteActionProps) {
  const [pending, setPending] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        disabled={disabled}
        className={
          className ??
          "inline-flex size-8 items-center justify-center disabled:cursor-not-allowed disabled:opacity-40"
        }
        onClick={() => setPending(true)}
      >
        <Trash2 className="size-4 text-red-700" />
      </button>
      <LifecycleConfirmDialog
        pending={pending ? syntheticLifecycleItem("eliminar", title, description) : null}
        entityLabel={entityLabel}
        onClose={() => setPending(false)}
        onConfirm={async (reason) => {
          await onConfirm(reason);
        }}
      />
    </>
  );
}
