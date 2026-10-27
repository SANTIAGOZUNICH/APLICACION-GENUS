"use client";

import { useCallback, useMemo, useState } from "react";
import type { OperationalRowCheck } from "@/features/os/operational/components/operational-ui";
import { DepositoDeleteBar, type DeleteScope } from "./deposito-delete-bar";
import { DeletionHistoryDialog } from "./deletion-history-dialog";

export type DepositoBulkResult = { requested: number; deleted: string[]; skipped: string[]; failed: Array<{ id: string; message: string }> };

/** Texto de resultado: cuántos se eliminaron y, si hubo, cuántos fallaron (se pueden reintentar: lo ya eliminado se omite). */
export function bulkResultMessage(res: DepositoBulkResult, noun: string): string {
  const n = res.deleted.length;
  const base = `${n} ${noun} eliminado${n === 1 ? "" : "s"}${res.skipped.length ? ` · ${res.skipped.length} ya no estaban` : ""}`;
  if (res.failed.length === 0) return `${base}.`;
  return `${base} · ${res.failed.length} con error (${res.failed[0]!.message}). Podés volver a intentarlo: lo ya eliminado no se repite.`;
}

/**
 * Selección y eliminación múltiple de una tabla de Depósito. Tres alcances bien separados: las SELECCIONADAS, TODAS LAS
 * VISIBLES (lo que dejan los filtros) y TODOS LOS REGISTROS de la tabla (también los ocultos por filtros).
 * Una sola confirmación con la cantidad; sin motivo. El servidor hace la baja lógica con auditoría.
 */
export function useDepositoDelete({
  canWrite,
  visibleIds,
  tableCount,
  noun,
  deleteIds,
  deleteAll,
  afterDelete,
  onMessage,
  historyResource,
}: {
  /** Tabla ME cuyo historial de eliminaciones se ofrece (Graneles no lo usa: sus bajas se ven en el filtro «Anulado»). */
  historyResource?: "me_ingresos" | "me_salidas" | "me_stock";
  canWrite: boolean;
  visibleIds: readonly string[];
  /** Registros activos de la tabla (con o sin filtros). */
  tableCount: number;
  /** Plural, p. ej. «ingresos». */
  noun: string;
  deleteIds: (ids: string[]) => Promise<DepositoBulkResult>;
  deleteAll: () => Promise<DepositoBulkResult>;
  afterDelete: () => Promise<void> | void;
  onMessage?: (message: string) => void;
}) {
  const [raw, setRaw] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Lo que un filtro/búsqueda deja fuera de la vista se descarta de la selección (nunca se elimina algo que no se ve).
  const visibleKey = visibleIds.join("\0");
  const [seenKey, setSeenKey] = useState(visibleKey);
  if (seenKey !== visibleKey) {
    setSeenKey(visibleKey);
    const visible = new Set(visibleIds);
    setRaw((prev) => new Set([...prev].filter((id) => visible.has(id))));
  }
  const checked = useMemo(() => new Set(visibleIds.filter((id) => raw.has(id))), [visibleIds, raw]);
  const allChecked = visibleIds.length > 0 && checked.size === visibleIds.length;

  const onToggle = useCallback((id: string) => {
    setRaw((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const onToggleAll = useCallback(() => setRaw(allChecked ? new Set() : new Set(visibleIds)), [allChecked, visibleIds]);
  const clear = useCallback(() => setRaw(new Set()), []);

  const rowCheck = useMemo<OperationalRowCheck | undefined>(
    () => (canWrite ? { checked, onToggle, onToggleAll, allChecked } : undefined),
    [canWrite, checked, onToggle, onToggleAll, allChecked]
  );

  const run = useCallback(
    async (scope: DeleteScope) => {
      setBusy(true);
      try {
        const res = scope === "table" ? await deleteAll() : await deleteIds(scope === "selected" ? [...checked] : [...visibleIds]);
        setRaw(new Set());
        await afterDelete();
        const text = bulkResultMessage(res, noun);
        setMessage(text);
        onMessage?.(text);
      } catch (e) {
        const text = e instanceof Error && e.message ? e.message : "No se pudo eliminar.";
        setMessage(text);
        onMessage?.(text);
        await afterDelete();
      } finally {
        setBusy(false);
      }
    },
    [checked, visibleIds, deleteIds, deleteAll, afterDelete, noun, onMessage]
  );

  const bar = canWrite ? (
    <>
    <DepositoDeleteBar
      selectedCount={checked.size}
      visibleCount={visibleIds.length}
      tableCount={tableCount}
      noun={noun}
      busy={busy}
      message={message}
      onCancelSelection={clear}
      onConfirm={run}
      onOpenHistory={historyResource ? () => setHistoryOpen(true) : undefined}
    />
    {historyResource ? <DeletionHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} resource={historyResource} title={noun} /> : null}
    </>
  ) : null;

  return { rowCheck, bar, selectedCount: checked.size, clear };
}
