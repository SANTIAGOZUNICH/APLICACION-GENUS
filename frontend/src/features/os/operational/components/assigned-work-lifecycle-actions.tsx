"use client";

import { useState } from "react";
import { MoreVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SECTOR_LABELS, type SectorId } from "@/types/operational/sector";
import type { WorkItem } from "@/types/operational/work-item";
import { resolveAssignedWorkLifecycleAction } from "../lib/assigned-work-lifecycle";
import { canMutateAssignedWork } from "../lib/work-mutation-rbac";
import {
  deleteOrCancelManualWorkItem,
  getManualWorkItemById,
} from "../adapters/manual-work-items-repository";
import { recordWorkProgress } from "../store/operational-store";
import { postCancelWork } from "@/lib/api/live-sync-client";

interface AssignedWorkLifecycleActionsProps {
  item: WorkItem;
  actorSectorId: SectorId;
  actorName: string;
  finishedQty?: string;
  onChanged?: () => void;
  onToast?: (message: string, tone?: "ok" | "info") => void;
  /** Compact: only trash icon for eliminar/cancelar */
  compact?: boolean;
}

/**
 * Acciones visibles de eliminar/cancelar/archivar para Producción.
 * Manual → localStorage; planilla → overlay cancelado vía progress + Live Sync.
 */
export function AssignedWorkLifecycleActions({
  item,
  actorSectorId,
  actorName,
  finishedQty = "",
  onChanged,
  onToast,
  compact = false,
}: AssignedWorkLifecycleActionsProps) {
  const canMutate = canMutateAssignedWork(actorSectorId);
  const [dialog, setDialog] = useState<"eliminar" | "cancelar" | "archivar" | "info" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!canMutate) return null;

  const decision = resolveAssignedWorkLifecycleAction(
    { status: item.status, finishedQty },
    { hasProgressRecord: finishedQty.trim().length > 0 }
  );

  const open = (action: typeof dialog) => {
    setDialog(action);
    setReason("");
    setError(null);
  };

  const close = () => {
    setDialog(null);
    setReason("");
    setError(null);
  };

  const execute = () => {
    if (!dialog || dialog === "info") {
      close();
      return;
    }

    const isManual = Boolean(getManualWorkItemById(item.id));
    if (isManual) {
      const result = deleteOrCancelManualWorkItem({
        id: item.id,
        actorSectorId,
        actorName,
        cancelReason: reason,
        hasProgressRecord: finishedQty.trim().length > 0,
        finishedQty,
      });
      if (!result.ok) {
        setError(result.error);
        onToast?.(result.error, "info");
        return;
      }
      if (result.action === "cancelar") {
        void postCancelWork({
          itemId: item.id,
          reason: reason.trim(),
          cancelledBy: actorName,
          sector: item.sector,
          actorSectorId,
        }).catch(() => {});
      }
      onToast?.(
        result.action === "eliminar"
          ? "Trabajo eliminado de las listas activas."
          : result.action === "cancelar"
            ? "Trabajo cancelado."
            : "Trabajo archivado."
      );
      onChanged?.();
      close();
      return;
    }

    // Trabajo de planilla: baja vía overlay cancelado (no borra Sheets ni OE/OA).
    if (dialog === "archivar") {
      setError(
        "Los trabajos de planilla finalizados no se archivan aquí. Usá Historial o el flujo de Entregados si corresponde."
      );
      return;
    }
    const cancelReason =
      dialog === "eliminar"
        ? "Eliminado por Producción (pendiente sin avances)."
        : reason.trim();
    if (dialog === "cancelar" && !cancelReason) {
      setError("El motivo de cancelación es obligatorio.");
      return;
    }
    recordWorkProgress(item.id, {
      finishedQty: finishedQty || "",
      observation: `Cancelado: ${cancelReason}`,
      status: "cancelado",
      updatedBy: actorName,
    });
    void postCancelWork({
      itemId: item.id,
      reason: cancelReason,
      cancelledBy: actorName,
      sector: item.sector,
      actorSectorId,
    }).catch(() => {});
    onToast?.(
      dialog === "eliminar"
        ? "Trabajo de planilla quitado de listas activas (cancelado)."
        : "Trabajo de planilla cancelado."
    );
    onChanged?.();
    close();
  };

  const primaryLabel =
    decision.action === "eliminar"
      ? "Eliminar trabajo"
      : decision.action === "cancelar"
        ? "Cancelar trabajo"
        : decision.action === "archivar"
          ? "Archivar"
          : "Ver motivo";

  const primaryAction =
    decision.action === "bloquear_finalizado" ? "info" : decision.action;

  return (
    <>
      <div className="flex items-center gap-1.5">
        {(decision.action === "eliminar" || decision.action === "cancelar") && (
          <button
            type="button"
            title={
              decision.action === "eliminar"
                ? "Eliminar trabajo pendiente sin avances"
                : "Cancelar trabajo con avances (requiere motivo)"
            }
            aria-label={primaryLabel}
            onClick={() => open(primaryAction)}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-rose-200 bg-rose-50 px-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            {!compact && <span>{primaryLabel}</span>}
          </button>
        )}
        <details className="group relative">
          <summary
            className="inline-flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded border border-[var(--os-border)] text-[var(--os-text-muted)] hover:text-[var(--os-text)] [&::-webkit-details-marker]:hidden"
            aria-label={`Más acciones para ${item.product ?? "trabajo"}`}
            title="Más acciones"
          >
            <MoreVertical className="size-4" aria-hidden="true" />
          </summary>
          <div className="absolute right-0 z-20 mt-1 min-w-48 rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] p-1 shadow-lg">
            {decision.action === "eliminar" && (
              <button
                type="button"
                className="block w-full rounded px-3 py-1.5 text-left text-xs font-medium text-rose-700 hover:bg-[var(--os-bg)]"
                onClick={() => open("eliminar")}
              >
                Eliminar trabajo
              </button>
            )}
            {decision.action === "cancelar" && (
              <button
                type="button"
                className="block w-full rounded px-3 py-1.5 text-left text-xs font-medium text-rose-700 hover:bg-[var(--os-bg)]"
                onClick={() => open("cancelar")}
              >
                Cancelar trabajo
              </button>
            )}
            {decision.action === "archivar" && (
              <button
                type="button"
                className="block w-full rounded px-3 py-1.5 text-left text-xs font-medium hover:bg-[var(--os-bg)]"
                onClick={() => open("archivar")}
              >
                Archivar
              </button>
            )}
            {decision.action === "bloquear_finalizado" && (
              <button
                type="button"
                className="block w-full rounded px-3 py-1.5 text-left text-xs font-medium text-[var(--os-text-muted)] hover:bg-[var(--os-bg)]"
                onClick={() => open("info")}
              >
                Por qué no se puede borrar
              </button>
            )}
            <p className="px-3 py-1 text-[11px] leading-snug text-[var(--os-text-muted)]">
              {decision.reason}
            </p>
          </div>
        </details>
      </div>

      <ConfirmDialog
        open={dialog === "eliminar"}
        onOpenChange={(openState) => !openState && close()}
        title="Eliminar trabajo"
        description={`Se quitará de todas las listas activas. Producto: ${item.product ?? "—"}. Cliente: ${item.client ?? "—"}. Sector: ${SECTOR_LABELS[item.sector]}. Entrega: ${item.deliveryDate ?? item.plannedDate ?? "—"}. No se eliminan OE/OA, Calidad ni lotes.`}
        confirmLabel="Eliminar trabajo"
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={execute}
      />

      <Dialog open={dialog === "cancelar"} onOpenChange={(openState) => !openState && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar trabajo</DialogTitle>
            <DialogDescription>
              El trabajo quedará CANCELADO y saldrá de las listas activas. Quedará visible en Historial →
              Cancelados y eliminados. Indicá el motivo.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-[var(--os-text-muted)]">
            {item.product} · {item.client} · {SECTOR_LABELS[item.sector]}
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full rounded border border-[var(--os-border)] px-3 py-2 text-sm"
            placeholder="Motivo de cancelación"
          />
          {error && (
            <p role="alert" className="text-sm text-rose-700">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={close}>
              Volver
            </Button>
            <Button variant="destructive" onClick={execute} disabled={!reason.trim()}>
              Cancelar trabajo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={dialog === "archivar"}
        onOpenChange={(openState) => !openState && close()}
        title="Archivar trabajo"
        description={
          decision.action === "archivar"
            ? `${decision.reason} Producto: ${item.product ?? "—"}.`
            : decision.reason
        }
        confirmLabel="Archivar"
        cancelLabel="Cancelar"
        onConfirm={execute}
      />

      <ConfirmDialog
        open={dialog === "info"}
        onOpenChange={(openState) => !openState && close()}
        title="No se puede eliminar como pendiente"
        description={`${decision.reason} Si ya fue entregado, usá Entregados → Archivar / Borrar entrega.`}
        confirmLabel="Entendido"
        cancelLabel="Cerrar"
        onConfirm={close}
      />
    </>
  );
}
