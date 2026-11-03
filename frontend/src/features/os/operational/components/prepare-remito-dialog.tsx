"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { resolveBoxesEntry } from "@/lib/remitos/delivery-boxes-input";
import { describeDeliveryPacking } from "@/lib/remitos/delivery-packing";
import type { PackingGroup } from "@/lib/remitos/packing-math";
import { DeliveryBoxesSection } from "./delivery-boxes-section";

const fmt = (n: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(n);

export type PrepareRemitoTarget = {
  deliveryLineId: string;
  product: string;
  client: string;
  lote: string | null;
  sequence?: number | null;
  sourceLabel?: string | null;
  unit: string | null;
  /** Unidades que Producción recibió en esta entrega, las que ya figuran en remitos vigentes y las disponibles. */
  delivered: number;
  remitted: number;
  available: number;
  packingGroups: Array<{ cajas: number; unidadesPorCaja: number }>;
  observations: string | null;
};

type Json = Record<string, unknown>;

/**
 * «Preparar remito» de UNA entrega: toma cliente, producto, lote, unidades, cajas y observaciones ya registrados por Envasado/Codificado.
 * Se puede remitir toda la entrega o una parte (el saldo lo valida el servidor); en una parte, las cajas las completa Producción —nunca se
 * dividen ni se inventan—. Crea un BORRADOR de remito propio de esa entrega.
 */
export function PrepareRemitoDialog({ target, onClose, onDone }: { target: PrepareRemitoTarget; onClose: () => void; onDone: (message: string) => void }) {
  const full = target.remitted <= 1e-6 && Math.abs(target.available - target.delivered) <= 1e-6;
  const [qty, setQty] = useState(String(target.available));
  const [obs, setObs] = useState("");
  const [boxes, setBoxes] = useState<PackingGroup[]>(full ? target.packingGroups.map((g) => ({ ...g })) : []);
  const [showBoxes, setShowBoxes] = useState(full && target.packingGroups.length > 0);
  const [touchedBoxes, setTouchedBoxes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [requestIdValue] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `r${Date.now()}${Math.random().toString(36).slice(2)}`));
  const requestId = { current: requestIdValue };
  const parsed = qty.trim() === "" ? null : Number(qty.trim().replace(/\./g, "").replace(",", "."));
  const quantity = parsed != null && Number.isFinite(parsed) ? parsed : null;

  async function submit() {
    if (busyRef.current) return; // doble clic
    setError(null);
    if (quantity == null || quantity <= 0) return setError("Indicá cuántas unidades se remiten (mayor que 0).");
    if (quantity > target.available + 1e-6) return setError(`Solo quedan ${fmt(target.available)} u. disponibles para remitir de esta entrega.`);
    const entry = resolveBoxesEntry({ quantity, groups: showBoxes ? boxes : [] });
    if (!entry.ok) return setError(entry.error);
    busyRef.current = true;
    setBusy(true);
    try {
      const body: Json = { action: "prepare", lineId: target.deliveryLineId, quantity, observations: obs.trim() || null, requestId: requestId.current };
      // Si no se tocó el desglose y se remite todo, el servidor usa las cajas de la entrega; si no, se envía lo informado (o nada: queda para completar).
      if (showBoxes && (touchedBoxes || !full)) body.packingGroups = entry.groups;
      const res = await fetch("/api/v1/remitos/deliveries", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as { error?: string; remito?: { remitoNumber?: string | null; version?: number }; replayed?: boolean };
      if (!res.ok) throw new Error(json.error ?? "No se pudo preparar el remito.");
      onDone(json.replayed ? "Esa entrega ya tenía su remito preparado (no se duplicó)." : `Remito en borrador preparado por ${fmt(quantity)} u. Abrilo en Remitos → Borradores para revisarlo y emitirlo.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo preparar el remito.");
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent data-testid="prepare-remito-dialog">
        <DialogHeader>
          <DialogTitle>Preparar remito{target.sequence ? ` · entrega parcial ${target.sequence}` : ""}</DialogTitle>
          <DialogDescription>Los datos de esta entrega ya están cargados. El remito se crea en borrador; el despacho físico no se modifica.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[62vh] space-y-3 overflow-y-auto text-sm">
          <dl className="grid grid-cols-2 gap-2 rounded border border-[var(--os-border)] p-3">
            <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Cliente</dt><dd>{target.client || "—"}</dd></div>
            <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Producto</dt><dd>{target.product}</dd></div>
            <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Lote</dt><dd className="font-mono text-xs">{target.lote || "—"}</dd></div>
            <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Origen</dt><dd>{target.sourceLabel ?? "—"}</dd></div>
            <div className="col-span-2" data-testid="pr-summary"><dt className="text-xs uppercase text-[var(--os-text-muted)]">Esta entrega</dt>
              <dd>Recibidas {fmt(target.delivered)} u. · ya en remitos {fmt(target.remitted)} u. · <strong>disponibles {fmt(target.available)} u.</strong>{describeDeliveryPacking(target.packingGroups) ? ` · ${describeDeliveryPacking(target.packingGroups)}` : ""}</dd></div>
            {target.observations ? <div className="col-span-2"><dt className="text-xs uppercase text-[var(--os-text-muted)]">Observaciones de la entrega</dt><dd className="whitespace-pre-wrap">{target.observations}</dd></div> : null}
          </dl>
          <label className="block"><span className="font-medium">Unidades a remitir ({target.unit ?? "un."})</span>
            <input className="mt-1 w-full rounded border border-[var(--os-border)] bg-transparent px-3 py-2 tabular-nums" inputMode="numeric" value={qty} onChange={(e) => { const v = e.target.value; setQty(v); const n = Number(v.trim().replace(/\./g, "").replace(",", ".")); // las cajas de la entrega completa no valen para una parte: no se asumen
              if (!touchedBoxes && boxes.length > 0 && Number.isFinite(n) && n !== target.available) { setBoxes([]); setShowBoxes(false); } }} data-testid="pr-qty" /></label>
          {!full ? <p className="text-xs text-[var(--os-text-muted)]" data-testid="pr-partial-note">Remitís una parte de la entrega: informá las cajas de esas unidades (no se asumen ni se dividen). Si todavía no las tenés, completalas en el borrador antes de emitir.</p> : null}
          <DeliveryBoxesSection boxes={boxes} onBoxesChange={(b) => { setTouchedBoxes(true); setBoxes(b); }} expected={quantity} onUseTotal={(t) => setQty(String(t))} open={showBoxes} onOpenChange={setShowBoxes} prefix="pr" label="Cajas de este remito" />
          <label className="block"><span className="font-medium">Observaciones para el remito (opcional)</span>
            <textarea className="mt-1 w-full rounded border border-[var(--os-border)] bg-transparent px-3 py-2" rows={2} maxLength={500} value={obs} onChange={(e) => setObs(e.target.value)} data-testid="pr-obs" /></label>
          {error ? <p role="alert" className="text-amber-300" data-testid="pr-error">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cerrar</Button>
          <Button onClick={() => void submit()} disabled={busy} data-testid="pr-confirm">{busy ? "Preparando…" : "Preparar remito"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
