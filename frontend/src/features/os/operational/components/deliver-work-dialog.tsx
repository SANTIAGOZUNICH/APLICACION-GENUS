"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { formatQty, parseQuantity, planDeliveryStep } from "@/lib/planning/circuit/delivery-math";
import { parseBulkRemainderKg } from "../lib/bulk-remainder";
import { newIdempotencyKey, type DeliveryProgress } from "../adapters/circuit-client";
import { WorkItemWarningBadge } from "./work-item-warning-badge";
import { PackingGroupsEditor } from "./packing-groups-editor";
import type { PackingGroup } from "@/lib/remitos/packing-math";
import { validateDeliveryPacking } from "@/lib/remitos/delivery-packing";

export interface DeliverWorkPayload {
  /** Unidades entregadas ahora (null = todo el saldo). */
  deliverQuantity: number | null;
  actualDeliveredAt: string;
  remito: string;
  receivedBy: string;
  observations: string;
  bulkRemainderKg?: number | null;
  bulkRemainderObservation?: string | null;
  /** Cajas de ESTA entrega (distintas cantidades por caja). null = sin detalle. */
  deliveryPackingGroups?: Array<{ cajas: number; unidadesPorCaja: number }> | null;
  /** Misma clave en cada reintento/doble clic de ESTA apertura del diálogo. */
  idempotencyKey: string;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Trabajo (para avisos de datos faltantes). Opcional: si no está cargado se usan los rótulos. */
  item?: WorkItem | null;
  productLabel?: string | null;
  clientLabel?: string | null;
  title?: string;
  /** Cantidad total a entregar (embalado/final/planificada) o null si no es numérica. */
  target: number | null;
  unit: string | null;
  /** Entrega vigente (parciales previas), si existe. */
  progress: DeliveryProgress | null;
  /** Envasado: pide el sobrante de granel. */
  showBulkRemainder?: boolean;
  /** Contenido extra bajo el encabezado (resumen de cajas, leyenda de la regla de cajas, etc.). */
  notice?: ReactNode;
  /** Texto del botón de confirmar. */
  submitLabel?: string;
  onConfirm: (payload: DeliverWorkPayload) => Promise<void>;
};

function nowDatetimeLocal(): string {
  const date = new Date();
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function toIso(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

/**
 * Entrega final (total o parcial) — circuito sin Calidad, SIN aprobación previa. La cantidad por defecto es todo el
 * saldo; si se entrega menos, el trabajo queda con saldo pendiente y NO se marca entregado. La clave de
 * idempotencia se fija al abrir el diálogo: un doble clic o un reintento tras un error de red es la MISMA entrega.
 */
export function DeliverWorkDialog({
  open,
  onOpenChange,
  item,
  productLabel,
  clientLabel,
  title = "Entregar",
  target,
  unit,
  progress,
  showBulkRemainder = false,
  notice,
  submitLabel = "Confirmar entrega",
  onConfirm,
}: Props) {
  const delivered = progress ? progress.delivered : 0;
  const balance = target != null ? Math.max(0, target - delivered) : null;
  const [quantity, setQuantity] = useState("");
  const [at, setAt] = useState(nowDatetimeLocal());
  const [remito, setRemito] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [observations, setObservations] = useState("");
  const [bulkKg, setBulkKg] = useState("");
  const [bulkObs, setBulkObs] = useState("");
  const [boxes, setBoxes] = useState<PackingGroup[]>([]);
  const [showBoxes, setShowBoxes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string>(newIdempotencyKey("deliver"));

  useEffect(() => {
    if (!open) return;
    keyRef.current = newIdempotencyKey("deliver");
    setQuantity(balance != null ? formatQty(balance) : "");
    setAt(nowDatetimeLocal());
    setRemito("");
    setReceivedBy("");
    setObservations("");
    setBulkKg("");
    setBulkObs("");
    setBoxes([]);
    setShowBoxes(false);
    setError(null);
    setBusy(false);
    // Solo al abrir: el saldo cambia recién cuando se cierra/confirma.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const requested = useMemo(() => {
    if (quantity.trim() === "") return null;
    return parseQuantity(quantity, unit);
  }, [quantity, unit]);

  const preview = useMemo(() => {
    if (target == null) return null;
    return planDeliveryStep({ target, alreadyDelivered: delivered, requested, unit });
  }, [target, delivered, requested, unit]);

  async function submit() {
    if (busy) return; // doble clic
    setError(null);
    if (!at) {
      setError("La fecha y hora real de entrega son obligatorias.");
      return;
    }
    if (target != null) {
      const step = planDeliveryStep({ target, alreadyDelivered: delivered, requested, unit });
      if (!step.ok) {
        setError(step.error);
        return;
      }
    }
    let deliveryPackingGroups: Array<{ cajas: number; unidadesPorCaja: number }> | null = null;
    if (showBoxes) {
      const stepUnits = requested ?? balance;
      const packing = validateDeliveryPacking(boxes, stepUnits);
      if (!packing.ok) {
        setError(packing.error);
        return;
      }
      deliveryPackingGroups = packing.groups.length > 0 ? packing.groups : null;
    }
    let bulk: ReturnType<typeof parseBulkRemainderKg> | null = null;
    if (showBulkRemainder) {
      bulk = parseBulkRemainderKg(bulkKg);
      if (!bulk.ok) {
        setError(bulk.error);
        return;
      }
    }
    setBusy(true);
    try {
      await onConfirm({
        deliverQuantity: requested,
        actualDeliveredAt: toIso(at),
        remito: remito.trim(),
        receivedBy: receivedBy.trim(),
        observations: observations.trim(),
        bulkRemainderKg: bulk && bulk.ok ? bulk.kg : null,
        bulkRemainderObservation: bulkObs.trim() || null,
        deliveryPackingGroups,
        idempotencyKey: keyRef.current,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar la entrega. Reintentá.");
    } finally {
      setBusy(false);
    }
  }

  const isPartial = preview?.ok === true && !preview.complete;
  const unitLabel = unit ? ` ${unit}` : "";

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent data-testid="deliver-work-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {displayField(productLabel ?? item?.product)} · {displayField(clientLabel ?? item?.client)}. Registra la
            entrega final al cliente, sin aprobación previa.
          </DialogDescription>
        </DialogHeader>
        {item ? <WorkItemWarningBadge item={item} className="mb-1" /> : null}
        <div className="max-h-[60vh] space-y-3 overflow-y-auto overflow-x-hidden text-sm">
          {notice}
          <dl className="grid grid-cols-3 gap-2 rounded border border-[var(--os-border)] p-2 text-xs" data-testid="deliver-balance">
            <div>
              <dt className="text-[var(--os-text-muted)]">Total a entregar</dt>
              <dd className="font-medium tabular-nums">{target != null ? `${formatQty(target)}${unitLabel}` : "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--os-text-muted)]">Ya entregado</dt>
              <dd className="font-medium tabular-nums">{`${formatQty(delivered)}${unitLabel}`}</dd>
            </div>
            <div>
              <dt className="text-[var(--os-text-muted)]">Saldo pendiente</dt>
              <dd className="font-medium tabular-nums">{balance != null ? `${formatQty(balance)}${unitLabel}` : "—"}</dd>
            </div>
          </dl>

          <label className="block">
            <span className="font-medium">Cantidad a entregar ahora{unit ? ` (${unit})` : ""} *</span>
            <input
              type="text"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2 tabular-nums"
              data-testid="deliver-quantity"
            />
            <span className="mt-1 block text-xs text-[var(--os-text-muted)]">
              Si entregás menos que el saldo, la entrega es PARCIAL: queda el saldo pendiente y el trabajo no se marca como
              entregado hasta completar la cantidad.
            </span>
          </label>
          {isPartial && preview?.ok ? (
            <p className="rounded bg-[var(--genus-warning-soft)] px-2 py-1 text-xs text-[var(--genus-warning)]" data-testid="deliver-partial-note">
              Entrega parcial: quedarán {formatQty(preview.pending)}
              {unitLabel} pendientes.
            </p>
          ) : null}

          <label className="block">
            <span className="font-medium">Fecha y hora real de entrega *</span>
            <input
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
              className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2"
              data-testid="deliver-at"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="font-medium">Remito</span>
              <input
                type="text"
                value={remito}
                onChange={(e) => setRemito(e.target.value)}
                className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2"
                data-testid="deliver-remito"
              />
            </label>
            <label className="block">
              <span className="font-medium">Recibe</span>
              <input
                type="text"
                value={receivedBy}
                onChange={(e) => setReceivedBy(e.target.value)}
                className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2"
                data-testid="deliver-received-by"
              />
            </label>
          </div>
          <label className="block">
            <span className="font-medium">Observaciones</span>
            <textarea
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2"
              data-testid="deliver-observations"
            />
          </label>
          <div className="rounded border border-[var(--os-border)] p-2" data-testid="deliver-boxes-section">
            <button
              type="button"
              className="min-h-10 text-xs font-medium text-[var(--os-teal)]"
              onClick={() => setShowBoxes((v) => !v)}
              data-testid="deliver-boxes-toggle"
            >
              {showBoxes ? "▾ Cajas de esta entrega" : "▸ Cargar cajas de esta entrega (opcional)"}
            </button>
            {showBoxes ? (
              <div className="mt-2 space-y-2">
                <PackingGroupsEditor groups={boxes} onChange={setBoxes} testIdPrefix="deliver-box" />
                {(() => {
                  const live = validateDeliveryPacking(boxes, null);
                  const total = live.ok ? live.unidades : 0;
                  const cajas = live.ok ? live.cajas : 0;
                  const expected = requested ?? balance;
                  return (
                    <p className={`text-xs ${expected != null && total > 0 && total !== expected ? "text-[var(--genus-warning)]" : "text-[var(--os-text-muted)]"}`} data-testid="deliver-boxes-total">
                      Total: {cajas} {cajas === 1 ? "caja" : "cajas"} · {total} u.
                      {expected != null ? ` (la entrega es de ${formatQty(expected)} u.)` : ""}
                    </p>
                  );
                })()}
              </div>
            ) : null}
          </div>
          {showBulkRemainder ? (
            <>
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
            </>
          ) : null}
          {error ? (
            <p className="text-sm text-[var(--genus-error,#b91c1c)]" role="alert" data-testid="deliver-error">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy} data-testid="confirm-deliver">
            {busy ? "Registrando…" : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
