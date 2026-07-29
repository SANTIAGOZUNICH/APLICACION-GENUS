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

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: WorkItem;
  finishedQty: string;
  observation: string;
  onConfirm: (payload: {
    finishedQty: string;
    observation: string;
    bulkRemainderKg?: number | null;
    bulkRemainderObservation?: string | null;
  }) => void;
};

/** Modal Finalizar → Calidad con sobrante de granel opcional. */
export function FinishToQualityDialog({
  open,
  onOpenChange,
  item,
  finishedQty,
  observation,
  onConfirm,
}: Props) {
  const [bulkKg, setBulkKg] = useState("");
  const [bulkObs, setBulkObs] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBulkKg("");
    setBulkObs("");
    setError(null);
  }, [open]);

  function submit() {
    const bulk = parseBulkRemainderKg(bulkKg);
    if (!bulk.ok) {
      setError(bulk.error);
      return;
    }
    onConfirm({
      finishedQty: finishedQty || item.quantity || "",
      observation,
      bulkRemainderKg: bulk.kg,
      bulkRemainderObservation: bulkObs.trim() || null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="finish-to-quality-dialog">
        <DialogHeader>
          <DialogTitle>Enviar a Calidad</DialogTitle>
          <DialogDescription>
            {displayField(item.product)} pasará a la bandeja de Calidad y ya no vas a poder editar el
            avance. ¿Confirmás que terminaste este trabajo?
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="font-medium">Sobrante de granel (kg) — opcional</span>
            <input
              type="text"
              inputMode="decimal"
              value={bulkKg}
              onChange={(e) => setBulkKg(e.target.value)}
              placeholder="ej. 12,5"
              className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2"
              data-testid="finish-bulk-kg"
            />
          </label>
          <label className="block">
            <span className="font-medium">Observación del sobrante</span>
            <input
              type="text"
              value={bulkObs}
              onChange={(e) => setBulkObs(e.target.value)}
              className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2"
            />
          </label>
          {error ? <p className="text-[var(--genus-error,#b91c1c)]">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={submit}>
            Sí, enviar a Calidad
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
