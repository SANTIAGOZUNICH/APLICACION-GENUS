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
import type { SectorId } from "@/types/operational/sector";
import type { WorkItem } from "@/types/operational/work-item";
import { fetchWorkItemById, postDeleteWork } from "@/lib/api/live-sync-client";
import { canMutateAssignedWork } from "../lib/work-mutation-rbac";
import { EditAssignmentDialog } from "./edit-assignment-dialog";

interface WorkItemEditDeleteActionsProps {
  item: WorkItem;
  actorSectorId: SectorId;
  actorName: string;
  onChanged?: () => void;
  onToast?: (message: string, tone?: "ok" | "info") => void;
  disabled?: boolean;
}

/**
 * [EDITAR TRABAJO] / [ELIMINAR TRABAJO] — siempre disponibles para
 * Producción, sin importar el estado del trabajo (a diferencia del menú de
 * lifecycle heredado, que mapea "eliminar" a cancelar en varios casos —
 * ver assigned-work-lifecycle.ts). Ambos flujos hacen fresh-fetch por id
 * ANTES de abrir el diálogo — nunca confían en el objeto ya cargado en
 * React — y viajan con `version` para la concurrencia optimista.
 */
export function WorkItemEditDeleteActions({
  item,
  actorSectorId,
  actorName,
  onChanged,
  onToast,
  disabled,
}: WorkItemEditDeleteActionsProps) {
  const [editItem, setEditItem] = useState<WorkItem | null>(null);
  const [editLoading, setEditLoading] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<WorkItem | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  if (!canMutateAssignedWork(actorSectorId)) return null;

  async function handleOpenEdit() {
    setFetchError(null);
    setEditLoading(true);
    try {
      const fresh = await fetchWorkItemById(item.id);
      setEditItem(fresh.item);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "No se pudo obtener el trabajo actualizado.");
      onToast?.("No se pudo abrir edición — reintentá.", "info");
    } finally {
      setEditLoading(false);
    }
  }

  async function handleOpenDelete() {
    setFetchError(null);
    setDeleteError(null);
    setDeleteReason("");
    setEditLoading(true);
    try {
      const fresh = await fetchWorkItemById(item.id);
      setDeleteTarget(fresh.item);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "No se pudo obtener el trabajo actualizado.");
      onToast?.("No se pudo abrir eliminación — reintentá.", "info");
    } finally {
      setEditLoading(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    if (!deleteReason.trim()) {
      setDeleteError("El motivo es obligatorio para eliminar un trabajo.");
      return;
    }
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      const response = await postDeleteWork({
        itemId: deleteTarget.id,
        reason: deleteReason.trim(),
        deletedBy: actorName,
        actorSectorId,
        expectedVersion: deleteTarget.version,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        if (response.status === 409) {
          setDeleteError(
            "⚠ Este trabajo fue modificado mientras lo estabas eliminando. Actualizá y revisá antes de continuar."
          );
        } else {
          setDeleteError(body.error ?? "No se pudo eliminar el trabajo.");
        }
        return;
      }
      setDeleteTarget(null);
      onToast?.("Trabajo eliminado.", "ok");
      onChanged?.();
    } catch {
      setDeleteError("Sin conexión con el servidor. Reintentá.");
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2" data-testid="work-item-edit-delete-actions">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={disabled || editLoading}
        onClick={handleOpenEdit}
        data-testid={`work-item-edit-${item.id}`}
      >
        {editLoading ? "Abriendo…" : "Editar"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        disabled={disabled || editLoading}
        onClick={handleOpenDelete}
        data-testid={`work-item-delete-${item.id}`}
      >
        Eliminar trabajo
      </Button>
      {fetchError ? <span className="text-xs text-[var(--genus-error,#e85d5d)]">{fetchError}</span> : null}

      {editItem ? (
        <EditAssignmentDialog
          key={editItem.id}
          item={editItem}
          actorSectorId={actorSectorId}
          actorName={actorName}
          onClose={() => setEditItem(null)}
          onSaved={(message) => {
            setEditItem(null);
            onToast?.(message, "ok");
            onChanged?.();
          }}
        />
      ) : null}

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Eliminar este trabajo?</DialogTitle>
            <DialogDescription>
              {deleteTarget ? (
                <>
                  {deleteTarget.product || "—"} · {deleteTarget.client || "—"}
                  {deleteTarget.packagingLote ? ` · Lote ${deleteTarget.packagingLote}` : ""}
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="delete-reason">
              Motivo de eliminación
            </label>
            <textarea
              id="delete-reason"
              rows={2}
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm"
              disabled={deleteLoading}
              data-testid="work-item-delete-reason-input"
            />
            {deleteError ? <p className="text-xs text-[var(--genus-error,#e85d5d)]">{deleteError}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={() => setDeleteTarget(null)} disabled={deleteLoading}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteLoading || !deleteReason.trim()}
              onClick={handleConfirmDelete}
              data-testid="work-item-delete-confirm"
            >
              {deleteLoading ? "Eliminando…" : "Eliminar trabajo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
