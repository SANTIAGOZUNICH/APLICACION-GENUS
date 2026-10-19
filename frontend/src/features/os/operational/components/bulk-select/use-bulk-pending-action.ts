"use client";

import { useCallback, useRef, useState } from "react";
import {
  postBulkPendingAction,
  newIdempotencyKey,
} from "../../adapters/circuit-client";
import type {
  BulkActionResult,
  BulkActionVerdict,
  BulkPendingAction,
} from "../../lib/bulk-action-verdicts";
import type { BulkPendingConfirmPayload } from "./bulk-pending-action-dialog";

type Session = { email?: string | null; sector?: string | null };

interface Options {
  session: Session;
  selectedIds: string[];
  /** Cantidad total propuesta por trabajo (Codificado). */
  defaultTotals?: Record<string, number | null>;
  onDone: (result: BulkActionResult) => void | Promise<void>;
  showToast: (message: string, tone?: "info" | "success") => void;
}

/**
 * Flujo de una acción masiva reutilizando el flujo individual: abrir → vista previa del servidor (ejecuta el flujo
 * real y lo revierte) → confirmar. La clave de la operación se fija al abrir: doble clic o reintento = misma operación.
 */
export function useBulkPendingAction({
  session,
  selectedIds,
  defaultTotals,
  onDone,
  showToast,
}: Options) {
  const [action, setAction] = useState<BulkPendingAction | null>(null);
  const [verdicts, setVerdicts] = useState<BulkActionVerdict[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const batchKey = useRef("");
  const idsRef = useRef<string[]>([]);

  const toItems = useCallback(
    (totals?: Record<string, number | null>) =>
      idsRef.current.map((id) => ({
        id,
        totalUnits: totals?.[id] ?? defaultTotals?.[id] ?? null,
      })),
    [defaultTotals],
  );

  const start = useCallback(
    (a: BulkPendingAction) => {
      if (selectedIds.length === 0) return;
      idsRef.current = [...selectedIds];
      batchKey.current = newIdempotencyKey(
        a === "DELIVER" ? "bulk-deliver" : "bulk-codif",
      );
      setVerdicts(null);
      setPreviewError(null);
      setAction(a);
      void postBulkPendingAction(session, {
        action: a,
        items: toItems(),
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
    },
    [selectedIds, session, toItems],
  );

  const close = useCallback((open: boolean) => {
    if (!open) setAction(null);
  }, []);

  const confirm = useCallback(
    async (payload: BulkPendingConfirmPayload) => {
      if (!action || busyRef.current) return; // bloquea confirmaciones repetidas
      busyRef.current = true;
      setBusy(true);
      try {
        const result = await postBulkPendingAction(session, {
          action,
          items: toItems(payload.totals),
          batchKey: batchKey.current,
          delivery: payload.delivery,
          observation: payload.observation,
        });
        const ok = result.succeeded.length;
        const rejected = result.verdicts.filter(
          (v) => v.code !== "ELIGIBLE",
        ).length;
        const verb =
          action === "DELIVER"
            ? "registraron como entregados"
            : "enviaron a Codificado";
        showToast(
          rejected > 0
            ? `Se ${verb} ${ok} trabajo(s). ${rejected} no se pudieron procesar y quedaron sin cambios.`
            : `Se ${verb} ${ok} trabajo(s).`,
          ok > 0 ? "success" : "info",
        );
        setAction(null);
        await onDone(result);
      } catch (err) {
        showToast(
          err instanceof Error
            ? err.message
            : "No se pudo procesar la selección.",
          "info",
        );
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [action, session, toItems, showToast, onDone],
  );

  return { action, verdicts, previewError, busy, start, close, confirm };
}
