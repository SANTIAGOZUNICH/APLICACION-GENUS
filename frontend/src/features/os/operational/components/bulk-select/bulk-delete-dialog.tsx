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
  summarizeVerdicts,
  type BulkDeleteVerdict,
} from "../../lib/bulk-delete-verdicts";

export interface BulkDeleteDialogItem {
  id: string;
  label: string;
  detail?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Registros seleccionados (tal cual los ve la tabla). */
  items: BulkDeleteDialogItem[];
  /** Veredictos del servidor (dry-run). null mientras se consulta. */
  verdicts: BulkDeleteVerdict[] | null;
  previewError?: string | null;
  busy?: boolean;
  /** «trabajos», «borradores», … */
  entityPlural?: string;
  onConfirm: (reason: string) => void;
}

/**
 * Confirmación de eliminación masiva: cantidad, qué registros entran, cuáles no se pueden eliminar y por qué,
 * advertencia operativa y motivo obligatorio. Nunca elimina por sí solo: solo «Confirmar eliminación» dispara onConfirm.
 */
export function BulkDeleteDialog(props: Props) {
  // El contenido se monta solo mientras el modal está abierto → el motivo arranca vacío en cada apertura.
  return (
    <Dialog
      open={props.open}
      onOpenChange={(o) => !props.busy && props.onOpenChange(o)}
    >
      <BulkDeleteDialogBody {...props} />
    </Dialog>
  );
}

function BulkDeleteDialogBody({
  onOpenChange,
  items,
  verdicts,
  previewError,
  busy,
  entityPlural = "registros",
  onConfirm,
}: Props) {
  const [reason, setReason] = useState("");

  const byId = new Map((verdicts ?? []).map((v) => [v.id, v]));
  const included = items.filter((i) => byId.get(i.id)?.code === "ELIGIBLE");
  const excluded = items.filter((i) => {
    const code = byId.get(i.id)?.code;
    return code && code !== "ELIGIBLE";
  });
  const summary = summarizeVerdicts(verdicts ?? []);
  const canConfirm =
    !busy &&
    verdicts != null &&
    included.length > 0 &&
    reason.trim().length > 0 &&
    !previewError;

  return (
    <DialogContent data-testid="bulk-delete-dialog">
      <DialogHeader>
        <DialogTitle>
          {verdicts == null
            ? `Eliminar ${items.length} ${entityPlural}`
            : `Eliminar ${included.length} ${entityPlural}`}
        </DialogTitle>
        <DialogDescription>
          Se eliminan de forma lógica: el historial, las entregas y el stock no
          se modifican y se puede consultar en «Ver eliminados».
        </DialogDescription>
      </DialogHeader>

      <p
        className="rounded border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200"
        data-testid="bulk-delete-warning"
      >
        Atención: esta acción puede afectar información operativa (planificación
        y listados que usan estos {entityPlural}).
      </p>

      {previewError ? (
        <p
          className="rounded border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200"
          role="alert"
        >
          {previewError}
        </p>
      ) : null}
      {verdicts == null && !previewError ? (
        <p
          className="text-sm text-[var(--os-text-muted)]"
          data-testid="bulk-delete-checking"
        >
          Verificando qué {entityPlural} se pueden eliminar…
        </p>
      ) : null}

      {verdicts != null ? (
        <div className="max-h-64 space-y-3 overflow-y-auto text-sm">
          <section data-testid="bulk-delete-included">
            <h3 className="font-medium">Se eliminarán ({included.length})</h3>
            <ul className="mt-1 list-disc pl-5 text-xs">
              {included.map((i) => (
                <li key={i.id}>
                  {i.label}
                  {i.detail ? (
                    <span className="text-[var(--os-text-muted)]">
                      {" "}
                      · {i.detail}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
          {excluded.length > 0 ? (
            <section data-testid="bulk-delete-excluded">
              <h3 className="font-medium text-amber-300">
                No se pueden eliminar ({excluded.length}) — quedan sin cambios
              </h3>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {excluded.map((i) => (
                  <li key={i.id}>
                    {i.label} —{" "}
                    <span className="text-[var(--os-text-muted)]">
                      {byId.get(i.id)?.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {summary.eligible === 0 ? (
            <p className="text-xs text-[var(--os-text-muted)]">
              Ninguno de los seleccionados se puede eliminar.
            </p>
          ) : null}
        </div>
      ) : null}

      <label className="block text-sm">
        <span className="font-medium">Motivo (obligatorio)</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2"
          data-testid="bulk-delete-reason"
        />
      </label>

      <DialogFooter>
        <Button
          variant="secondary"
          onClick={() => onOpenChange(false)}
          disabled={busy}
          data-testid="bulk-delete-cancel"
        >
          Cancelar
        </Button>
        <Button
          variant="destructive"
          onClick={() => onConfirm(reason.trim())}
          disabled={!canConfirm}
          data-testid="bulk-delete-confirm"
        >
          {busy ? "Eliminando…" : "Confirmar eliminación"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
