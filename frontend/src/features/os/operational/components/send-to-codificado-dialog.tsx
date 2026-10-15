"use client";

import { useEffect, useState } from "react";
import type { WorkItem } from "@/types/operational/work-item";
import { displayField } from "@/lib/operational/display-fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { parseBulkRemainderKg } from "../lib/bulk-remainder";
import { resolveTotalUnitsForCodificado } from "../lib/codificado-flow";
import { WORK_TRANSFER } from "../lib/work-transfer-labels";
import { WorkItemWarningBadge } from "./work-item-warning-badge";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: WorkItem;
  defaultTotal: string;
  defaultObservation: string;
  onConfirm: (payload: {
    totalUnits: number;
    observation: string;
    bulkRemainderKg?: number | null;
    bulkRemainderObservation?: string | null;
  }) => void;
};

/** Modal Enviar a Codificado — solo exige cantidad total; cajas opcionales. */
export function SendToCodificadoDialog({
  open,
  onOpenChange,
  item,
  defaultTotal,
  defaultObservation,
  onConfirm,
}: Props) {
  const [total, setTotal] = useState(defaultTotal);
  const [observation, setObservation] = useState(defaultObservation);
  const [bulkKg, setBulkKg] = useState("");
  const [bulkObs, setBulkObs] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Unidades ya entregadas desde Envasado (parciales activas): el total enviado no puede ser menor. */
  const [deliveredSoFar, setDeliveredSoFar] = useState<number | null>(null);

  useEffect(() => {
    if (!open || !item.id.startsWith("native:")) {
      setDeliveredSoFar(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/v1/deliveries?workItemId=${encodeURIComponent(item.id)}`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { lines?: Array<{ quantity: number | string; status: string }> } | null) => {
        if (cancelled || !body?.lines) return;
        const sum = body.lines
          .filter((l) => l.status === "ACTIVA")
          .reduce((acc, l) => acc + Number(l.quantity), 0);
        setDeliveredSoFar(sum > 0 ? sum : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, item.id]);

  useEffect(() => {
    if (!open) return;
    setTotal(defaultTotal);
    setObservation(defaultObservation);
    setBulkKg("");
    setBulkObs("");
    setError(null);
  }, [open, defaultTotal, defaultObservation]);

  function submit() {
    const totalParsed = Number.parseFloat(String(total).replace(",", "."));
    const resolved = resolveTotalUnitsForCodificado({
      packagingTotalUnits: Number.isFinite(totalParsed) ? totalParsed : null,
      finishedQty: total,
      quantity: item.quantity,
    });
    if (!resolved.ok) {
      setError(resolved.error);
      return;
    }
    if (deliveredSoFar != null && resolved.total < deliveredSoFar - 1e-6) {
      setError(`El total (${resolved.total}) no puede ser menor a lo ya entregado (${deliveredSoFar}).`);
      return;
    }
    const bulk = parseBulkRemainderKg(bulkKg);
    if (!bulk.ok) {
      setError(bulk.error);
      return;
    }
    onConfirm({
      totalUnits: resolved.total,
      observation: observation.trim(),
      bulkRemainderKg: bulk.kg,
      bulkRemainderObservation: bulkObs.trim() || null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="send-to-codificado-dialog">
        <DialogHeader>
          <DialogTitle>{WORK_TRANSFER.sendToCodificadoAction}</DialogTitle>
          <DialogDescription>
            El trabajo pasa a Codificado con la misma identidad. No se envía a Calidad ni se genera remito.
          </DialogDescription>
        </DialogHeader>

        <WorkItemWarningBadge item={item} className="mb-1" />

        <div className="max-h-[60vh] space-y-3 overflow-y-auto overflow-x-hidden text-sm">
          {deliveredSoFar != null ? (
            <p
              className="rounded border border-[var(--os-border)] px-3 py-2 text-xs"
              data-testid="codificado-delivered-so-far"
            >
              Ya entregado desde Envasado: <strong>{deliveredSoFar}</strong> un. El total que envíes debe ser igual o
              mayor; Codificado entregará el resto.
            </p>
          ) : null}
          <div>
            <p className="text-xs uppercase text-[var(--os-text-muted)]">Producto</p>
            <p className="font-medium">{displayField(item.product)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-[var(--os-text-muted)]">Cliente</p>
            <p className="font-medium">{displayField(item.client)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-[var(--os-text-muted)]">Lote actual (informativo)</p>
            <p className="font-medium">
              {displayField(item.packagingLote ?? item.loteRef)}
            </p>
          </div>
          <label className="block">
            <span className="text-sm font-medium">Cantidad total de unidades *</span>
            <input
              type="text"
              inputMode="decimal"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2"
              data-testid="codificado-total-units"
            />
            <span className="mt-1 block text-xs text-[var(--os-text-muted)]">
              Las cajas no son obligatorias para este envío.
            </span>
          </label>
          <label className="block">
            <span className="text-sm font-medium">Observaciones (opcional)</span>
            <textarea
              value={observation}
              onChange={(e) => setObservation(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Sobrante de granel (kg) — opcional</span>
            <input
              type="text"
              inputMode="decimal"
              value={bulkKg}
              onChange={(e) => setBulkKg(e.target.value)}
              placeholder="ej. 12,5"
              className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2"
              data-testid="codificado-bulk-kg"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Observación del sobrante</span>
            <input
              type="text"
              value={bulkObs}
              onChange={(e) => setBulkObs(e.target.value)}
              className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2"
            />
          </label>
          {error ? <p className="text-sm text-[var(--genus-error,#b91c1c)]">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={submit} data-testid="confirm-send-codificado">
            Confirmar envío
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
