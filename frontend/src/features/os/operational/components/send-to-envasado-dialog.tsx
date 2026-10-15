"use client";

import { useEffect, useRef, useState } from "react";
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
import { envasadoLinesFor, type EnvasadoDestination } from "@/lib/planning/circuit/destination";
import { usePreviewSession } from "@/features/os/session/preview-context";
import {
  fetchEnvasadoSuggestion,
  newIdempotencyKey,
  type EnvasadoSuggestion,
} from "../adapters/circuit-client";
import { WorkItemWarningBadge } from "./work-item-warning-badge";

export interface SendToEnvasadoPayload {
  destination: EnvasadoDestination;
  line: string;
  producedQuantity: string;
  unitsToPackage: string;
  observation: string;
  idempotencyKey: string;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: WorkItem;
  defaultProduced: string;
  defaultObservation: string;
  onConfirm: (payload: SendToEnvasadoPayload) => Promise<void>;
};

const DEST_LABEL: Record<EnvasadoDestination, string> = {
  ENVASADO_MASIVO: "Envasado Masivo",
  ENVASADO_PREMIUM: "Envasado Premium",
};

const REASON_LABEL: Record<string, string> = {
  PEDIDO_PRODUCTO: "según el mismo pedido y producto",
  PEDIDO: "según el pedido",
  HISTORIAL_CLIENTE_PRODUCTO: "según dónde se envasó antes este cliente y producto",
};

/**
 * Elaboración → Envasado Masivo/Premium, directo (sin Calidad ni aprobación). El destino se sugiere a partir del
 * pedido / historial; si no se puede deducir, hay que elegirlo. No es una entrega final del pedido.
 */
export function SendToEnvasadoDialog({
  open,
  onOpenChange,
  item,
  defaultProduced,
  defaultObservation,
  onConfirm,
}: Props) {
  const { email, sectorId } = usePreviewSession();
  const [destination, setDestination] = useState<EnvasadoDestination | "">("");
  const [suggestion, setSuggestion] = useState<EnvasadoSuggestion | null>(null);
  const [line, setLine] = useState("Línea 1");
  const [produced, setProduced] = useState(defaultProduced);
  const [units, setUnits] = useState("");
  const [observation, setObservation] = useState(defaultObservation);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string>(newIdempotencyKey("envasado"));

  useEffect(() => {
    if (!open) return;
    keyRef.current = newIdempotencyKey("envasado");
    setProduced(defaultProduced);
    setObservation(defaultObservation);
    setUnits("");
    setError(null);
    setBusy(false);
    setDestination("");
    setSuggestion(null);
    setLine("Línea 1");
    let cancelled = false;
    void fetchEnvasadoSuggestion({ email, sector: sectorId }, item.id)
      .then((s) => {
        if (cancelled) return;
        setSuggestion(s);
        if (s.sector) setDestination(s.sector);
        if (s.unitsHint) setUnits(s.unitsHint);
      })
      .catch(() => {
        // Sin sugerencia: la persona elige el destino a mano.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item.id]);

  async function submit() {
    if (busy) return;
    if (!destination) {
      setError("Elegí si va a Envasado Masivo o Envasado Premium.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm({
        destination,
        line,
        producedQuantity: produced.trim(),
        unitsToPackage: units.trim(),
        observation: observation.trim(),
        idempotencyKey: keyRef.current,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar a Envasado. Reintentá.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent data-testid="send-to-envasado-dialog">
        <DialogHeader>
          <DialogTitle>Enviar a Envasado</DialogTitle>
          <DialogDescription>
            {displayField(item.product)} pasa directo al Envasado elegido, con el mismo cliente, producto y lote. No hay
            aprobación previa ni es una entrega final del pedido.
          </DialogDescription>
        </DialogHeader>
        <WorkItemWarningBadge item={item} className="mb-1" />
        <div className="max-h-[60vh] space-y-3 overflow-y-auto overflow-x-hidden text-sm">
          <fieldset>
            <legend className="font-medium">Envasado de destino *</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {(["ENVASADO_MASIVO", "ENVASADO_PREMIUM"] as const).map((dest) => (
                <label
                  key={dest}
                  className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2 ${
                    destination === dest ? "border-[var(--os-teal)] bg-[var(--os-teal-soft)]" : "border-[var(--os-border)]"
                  }`}
                >
                  <input
                    type="radio"
                    name="envasado-destino"
                    value={dest}
                    checked={destination === dest}
                    onChange={() => {
                      setDestination(dest);
                      if (!envasadoLinesFor(dest).includes(line)) setLine("Línea 1");
                    }}
                    data-testid={`envasado-dest-${dest}`}
                  />
                  {DEST_LABEL[dest]}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-[var(--os-text-muted)]" data-testid="envasado-dest-hint">
              {suggestion?.sector
                ? `Sugerido ${REASON_LABEL[suggestion.reason] ?? ""}. Podés cambiarlo.`
                : suggestion
                  ? "No se pudo deducir el destino: elegilo vos."
                  : "Buscando el destino sugerido…"}
            </p>
          </fieldset>
          {destination ? (
            <label className="block">
              <span className="font-medium">Línea (si el trabajo de Envasado todavía no existe)</span>
              <select
                value={line}
                onChange={(e) => setLine(e.target.value)}
                className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2"
                data-testid="envasado-line"
              >
                {envasadoLinesFor(destination).map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block">
            <span className="font-medium">Kg elaborados</span>
            <input
              type="text"
              inputMode="decimal"
              value={produced}
              onChange={(e) => setProduced(e.target.value)}
              className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2 tabular-nums"
              data-testid="envasado-produced"
            />
          </label>
          <label className="block">
            <span className="font-medium">Unidades a envasar (opcional)</span>
            <input
              type="text"
              inputMode="numeric"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              placeholder="Si no se indica, se usa la del pedido"
              className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2 tabular-nums"
              data-testid="envasado-units"
            />
          </label>
          <label className="block">
            <span className="font-medium">Observaciones</span>
            <textarea
              value={observation}
              onChange={(e) => setObservation(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2"
            />
          </label>
          {error ? (
            <p className="text-sm text-[var(--genus-error,#b91c1c)]" role="alert" data-testid="envasado-error">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy} data-testid="confirm-send-envasado">
            {busy ? "Enviando…" : "Confirmar envío"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
