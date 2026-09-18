"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SectorId } from "@/types/operational/sector";
import {
  fetchDeletedWorkItems,
  postRestoreDeletedWork,
  type DeletedWorkItemEntry,
} from "@/lib/api/live-sync-client";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-AR");
}

interface DeletedWorkItemsPanelProps {
  actorSectorId: SectorId;
  actorName: string;
  onToast?: (message: string, tone?: "ok" | "info") => void;
}

/**
 * "☐ Ver eliminados" (sección 32) — lista work items nativos con soft-delete
 * activo (fecha/usuario/motivo) y permite restaurar. Nunca borra nada;
 * solo lee y, al restaurar, limpia deletedAt/deletedBy/deleteReason.
 */
export function DeletedWorkItemsPanel({ actorSectorId, actorName, onToast }: DeletedWorkItemsPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<DeletedWorkItemEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchDeletedWorkItems();
      setItems(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los trabajos eliminados.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [expanded, load]);

  async function handleRestore(entry: DeletedWorkItemEntry) {
    setRestoringId(entry.item.id);
    try {
      const response = await postRestoreDeletedWork({
        itemId: entry.item.id,
        actorSectorId,
        restoredBy: actorName,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "No se pudo restaurar el trabajo.");
      }
      onToast?.("Trabajo restaurado.", "ok");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo restaurar el trabajo.");
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div className="rounded-[var(--os-radius-md)] border border-[var(--os-border)] bg-[var(--os-surface)]">
      <label className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium text-[var(--os-text)]">
        <input
          type="checkbox"
          checked={expanded}
          onChange={(e) => setExpanded(e.target.checked)}
          data-testid="deleted-work-items-toggle"
        />
        Ver eliminados
      </label>

      {expanded ? (
        <div className="space-y-2 border-t border-[var(--os-border)] px-4 py-3" data-testid="deleted-work-items-body">
          {error ? <p className="text-sm text-[var(--genus-error,#e85d5d)]">{error}</p> : null}
          {loading ? <p className="text-xs text-[var(--os-text-muted)]">Cargando…</p> : null}
          {!loading && items.length === 0 ? (
            <p className="text-xs text-[var(--os-text-muted)]">No hay trabajos eliminados.</p>
          ) : null}
          <ul className="space-y-2">
            {items.map((entry) => (
              <li
                key={entry.item.id}
                data-testid={`deleted-work-item-${entry.item.id}`}
                className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span>
                    <span className="mr-2 rounded bg-[var(--genus-error,#e85d5d)]/15 px-1.5 py-0.5 text-xs font-semibold text-[var(--genus-error,#e85d5d)]">
                      ELIMINADO
                    </span>
                    {entry.item.product || "—"} · {entry.item.client || "—"}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={restoringId === entry.item.id}
                    onClick={() => handleRestore(entry)}
                    data-testid={`deleted-work-item-restore-${entry.item.id}`}
                  >
                    {restoringId === entry.item.id ? "Restaurando…" : "Restaurar"}
                  </Button>
                </div>
                <p className="mt-1 text-xs text-[var(--os-text-muted)]">
                  Eliminado {formatDateTime(entry.deletedAt)} · {entry.deletedBy || "—"} · Motivo:{" "}
                  {entry.deleteReason || "—"}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
