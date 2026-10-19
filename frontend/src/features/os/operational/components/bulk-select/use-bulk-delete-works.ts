"use client";

import { useCallback, useRef, useState } from "react";
import {
  postBulkDeleteWorks,
  newIdempotencyKey,
} from "../../adapters/circuit-client";
import type {
  BulkDeleteResult,
  BulkDeleteVerdict,
} from "../../lib/bulk-delete-verdicts";

type Session = { email?: string | null; sector?: string | null };

interface Options {
  session: Session;
  /** Ids seleccionados (`native:<uuid>`). */
  selectedIds: string[];
  /** Se llama tras una eliminación exitosa (limpiar selección + recargar tabla). */
  onDone: (result: BulkDeleteResult) => void | Promise<void>;
  showToast: (message: string, tone?: "info" | "success") => void;
}

/**
 * Flujo de eliminación masiva de trabajos: abrir → dry-run (veredictos del servidor) → confirmar con motivo.
 * Nada se elimina hasta `confirm`. La clave de idempotencia se fija al abrir el modal, así un doble clic
 * o un reintento de red no duplica la operación.
 */
export function useBulkDeleteWorks({
  session,
  selectedIds,
  onDone,
  showToast,
}: Options) {
  const [open, setOpen] = useState(false);
  const [verdicts, setVerdicts] = useState<BulkDeleteVerdict[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const batchKey = useRef<string>("");
  const idsRef = useRef<string[]>([]);

  const start = useCallback(() => {
    if (selectedIds.length === 0) return;
    idsRef.current = [...selectedIds];
    batchKey.current = newIdempotencyKey("bulk-delete");
    setVerdicts(null);
    setPreviewError(null);
    setOpen(true);
    void postBulkDeleteWorks(session, {
      ids: idsRef.current,
      reason: "",
      dryRun: true,
    })
      .then((r) => setVerdicts(r.verdicts))
      .catch((err) =>
        setPreviewError(
          err instanceof Error
            ? err.message
            : "No se pudo verificar la selección.",
        ),
      );
  }, [selectedIds, session]);

  const close = useCallback((o: boolean) => {
    if (!o) setOpen(false);
  }, []);

  const confirm = useCallback(
    async (reason: string) => {
      if (busy) return;
      setBusy(true);
      try {
        const result = await postBulkDeleteWorks(session, {
          ids: idsRef.current,
          reason,
          batchKey: batchKey.current,
        });
        const n = result.deleted.length;
        const skipped = result.verdicts.filter(
          (v) => v.code !== "ELIGIBLE" && v.code !== "ALREADY_DELETED",
        ).length;
        showToast(
          skipped > 0
            ? `Se eliminaron ${n} registro(s). ${skipped} no se pudieron eliminar y quedaron sin cambios.`
            : `Se eliminaron ${n} registro(s).`,
          "success",
        );
        setOpen(false);
        await onDone(result);
      } catch (err) {
        showToast(
          err instanceof Error
            ? err.message
            : "No se pudo eliminar la selección.",
          "info",
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, session, showToast, onDone],
  );

  return { open, verdicts, previewError, busy, start, close, confirm };
}
