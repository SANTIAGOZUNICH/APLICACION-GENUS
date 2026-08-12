"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SectorId } from "@/types/operational/sector";
import type { WorkItem } from "@/types/operational/work-item";
import { editWorkItemAssignment } from "../lib/edit-assignment";
import { correctWorkItemLoteVto } from "../lib/lote-vto-correction";

const CONTROL_CLASS =
  "w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--ig-control-bg,var(--os-surface))] px-3 py-2 text-sm text-[var(--ig-control-fg,var(--os-text))]";

interface EditAssignmentDialogProps {
  item: WorkItem | null;
  actorSectorId: SectorId;
  actorName: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/**
 * "Editar trabajo" — Producción corrige lo que asignó (producto/cliente/
 * cantidad/fecha de entrega/observaciones, y Lote/VTO por su mecanismo
 * propio ya auditado) SIN pisar avance de otro sector: el servidor solo
 * toca columnas de planificación, nunca finishedQty/packingGroups/etc.
 * Mismo diálogo para Elaboración/Masivo/Premium/Codificado — un solo
 * componente en vez de cuatro variantes.
 */
/**
 * El padre debe montar este componente con `key={item?.id ?? "closed"}` —
 * así el estado del formulario se inicializa fresco por cada trabajo
 * abierto (lazy useState) en vez de sincronizarlo con un efecto sobre
 * `item`, que dispara "setState en cascada dentro de un efecto" (lint).
 */
export function EditAssignmentDialog({
  item,
  actorSectorId,
  actorName,
  onClose,
  onSaved,
}: EditAssignmentDialogProps) {
  const [client, setClient] = useState(() => item?.client ?? "");
  const [product, setProduct] = useState(() => item?.product ?? "");
  const [quantity, setQuantity] = useState(() => item?.quantity ?? "");
  const [deliveryDate, setDeliveryDate] = useState(() => item?.deliveryDate ?? "");
  const [notes, setNotes] = useState(() => item?.notes ?? "");
  const [lote, setLote] = useState(() => item?.packagingLote ?? item?.loteRef ?? "");
  const [vto, setVto] = useState(() => item?.packagingVto ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!item) return null;

  const showLoteVto = item.sector !== "ELABORACION";

  const planningChanged =
    client.trim() !== (item.client ?? "") ||
    product.trim() !== (item.product ?? "") ||
    quantity.trim() !== (item.quantity ?? "") ||
    deliveryDate !== (item.deliveryDate ?? "") ||
    notes.trim() !== (item.notes ?? "");
  const loteVtoChanged =
    showLoteVto &&
    (lote.trim() !== (item.packagingLote ?? item.loteRef ?? "") ||
      vto.trim() !== (item.packagingVto ?? ""));

  const handleSave = async () => {
    if (!planningChanged && !loteVtoChanged) {
      onClose();
      return;
    }
    if (!reason.trim()) {
      setError("Indicá el motivo de la edición.");
      return;
    }
    setBusy(true);
    setError(null);

    if (loteVtoChanged) {
      const loteResult = await correctWorkItemLoteVto({
        itemId: item.id,
        packagingLote: lote,
        packagingVto: vto,
        reason,
        actorSectorId,
        updatedBy: actorName,
      });
      if (!loteResult.ok) {
        setBusy(false);
        setError(loteResult.error);
        return;
      }
    }

    if (planningChanged) {
      const result = await editWorkItemAssignment({
        itemId: item.id,
        client: client.trim(),
        product: product.trim(),
        plannedQuantity: quantity.trim(),
        deliveryDate: deliveryDate || null,
        notes: notes.trim() || null,
        reason,
        actorSectorId,
        updatedBy: actorName,
      });
      if (!result.ok) {
        setBusy(false);
        setError(result.error);
        return;
      }
    }

    setBusy(false);
    onSaved("Trabajo actualizado.");
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar trabajo</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="edit-client">
                Cliente
              </label>
              <input
                id="edit-client"
                value={client}
                onChange={(e) => setClient(e.target.value)}
                className={CONTROL_CLASS}
                disabled={busy}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="edit-product">
                Producto
              </label>
              <input
                id="edit-product"
                value={product}
                onChange={(e) => setProduct(e.target.value)}
                className={CONTROL_CLASS}
                disabled={busy}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="edit-quantity">
                Cantidad ({item.unit ?? "un."})
              </label>
              <input
                id="edit-quantity"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className={CONTROL_CLASS}
                disabled={busy}
              />
              <p className="text-xs text-[var(--os-text-muted)]">
                Corrige la cantidad planificada — no borra la cantidad realizada ya informada
                por el sector.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="edit-delivery">
                Fecha de entrega
              </label>
              <input
                id="edit-delivery"
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className={CONTROL_CLASS}
                disabled={busy}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="edit-notes">
              Observaciones
            </label>
            <textarea
              id="edit-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={CONTROL_CLASS}
              disabled={busy}
            />
          </div>

          {showLoteVto ? (
            <div className="space-y-3 rounded-[var(--os-radius-sm)] border border-[var(--os-border)] p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--os-text-muted)]">
                Lote / VTO — Producción es la fuente única
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="edit-lote">
                    Lote
                  </label>
                  <input
                    id="edit-lote"
                    value={lote}
                    onChange={(e) => setLote(e.target.value)}
                    className={CONTROL_CLASS}
                    disabled={busy}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="edit-vto">
                    VTO
                  </label>
                  <input
                    id="edit-vto"
                    value={vto}
                    onChange={(e) => setVto(e.target.value)}
                    className={CONTROL_CLASS}
                    disabled={busy}
                  />
                </div>
              </div>
              <p className="text-xs text-[var(--os-text-muted)]">
                Envasado/Codificado reciben este valor de solo lectura.
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="edit-reason">
              Motivo de la edición
            </label>
            <input
              id="edit-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Requerido si cambiás algún dato"
              className={CONTROL_CLASS}
              disabled={busy}
            />
          </div>

          {error ? (
            <p role="alert" className="text-xs text-[var(--genus-error)]">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} disabled={busy}>
            {busy ? "Guardando…" : "Guardar cambios"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
