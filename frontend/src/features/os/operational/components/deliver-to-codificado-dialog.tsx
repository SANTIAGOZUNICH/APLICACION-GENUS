"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchTransferView, fmtQty, postTransfer, type CodificadoTransferView } from "@/features/os/codificado-transfer/codificado-transfer-client";
import { usePreviewSession } from "@/features/os/session/preview-context";
import type { WorkItem } from "@/types/operational/work-item";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: WorkItem;
  /** Unidades realizadas que la persona tiene cargadas en el trabajo (puede subirlas acá mismo). */
  finishedDraft: string;
  onDone: (view: CodificadoTransferView) => void;
};

/**
 * «Entregar a Codificado» — entrega PARCIAL (o final) de lo terminado. El trabajo de Envasado sigue abierto por el saldo;
 * Codificado recibe las unidades de inmediato. Es un movimiento interno: no entrega nada al cliente ni toca el stock de Depósito.
 */
export function DeliverToCodificadoDialog({ open, onOpenChange, item, finishedDraft, onDone }: Props) {
  const { email, sectorId } = usePreviewSession();
  const [view, setView] = useState<CodificadoTransferView | null>(null);
  const [qty, setQty] = useState("");
  const [finished, setFinished] = useState("");
  const [obs, setObs] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Una clave por intento: un doble clic o un reintento tras un corte de red devuelve la MISMA entrega (no duplica).
  const keyRef = useRef<string>("");
  // Si la persona ya escribió, los valores sugeridos que llegan después del pedido al servidor NO pisan lo suyo.
  const edited = useRef(false);

  useEffect(() => {
    if (!open) return;
    keyRef.current = crypto.randomUUID();
    edited.current = false;
    let off = false;
    void fetchTransferView({ email, sector: sectorId }, item.id)
      .then((v) => {
        if (off) return;
        setError(null);
        setObs("");
        setView(v);
        if (edited.current) return;
        const draft = Number(String(finishedDraft).replace(",", "."));
        const s = v.summary;
        const known = s.produced ?? 0;
        setFinished(String(Math.max(known, Number.isFinite(draft) ? draft : 0) || ""));
        const out = s.assigned - s.pendingToTransfer; // ya salió (a Producción + a Codificado)
        const avail = Math.max(0, Math.max(known, Number.isFinite(draft) ? draft : 0) - out);
        setQty(avail > 0 ? String(avail) : "");
      })
      .catch((e) => !off && setError(e instanceof Error ? e.message : "No se pudo cargar el trabajo."));
    return () => {
      off = true;
    };
  }, [open, item.id, email, sectorId, finishedDraft]);

  const s = view?.summary;
  const out = s ? s.assigned - s.pendingToTransfer : 0; // lo que ya salió por cualquier vía (a Producción + a Codificado)

  async function confirm() {
    if (!s) return;
    const q = Number(qty.replace(",", "."));
    const f = Number(finished.replace(",", "."));
    if (!Number.isFinite(q) || q <= 0) return setError("Ingresá cuántas unidades entregás ahora (mayor que 0).");
    if (!Number.isInteger(q) && /^(un|u\b)/i.test(item.unit ?? "un.")) return setError("La cantidad debe ser un número entero de unidades.");
    if (!Number.isFinite(f) || f <= 0) return setError("Registrá cuántas unidades están terminadas (incluye las ya entregadas).");
    if (q > s.pendingToTransfer + 1e-6) return setError(`No podés entregar más de lo pendiente (${fmtQty(s.pendingToTransfer)}).`);
    if (q > f - out + 1e-6) return setError(`Solo hay ${fmtQty(Math.max(0, f - out))} unidades terminadas sin entregar. Subí las terminadas si ya las tenés.`);
    setBusy(true);
    setError(null);
    try {
      const res = await postTransfer({ email, sector: sectorId }, item.id, { quantity: q, finishedQty: f, observation: obs.trim() || null, idempotencyKey: keyRef.current });
      onDone(res.view);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar la entrega.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="deliver-to-codificado-dialog">
        <DialogHeader>
          <DialogTitle>Entregar a Codificado</DialogTitle>
          <DialogDescription>Codificado recibe estas unidades ya y puede empezar a codificarlas. El trabajo sigue en Envasado por lo que falte.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto text-sm">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Cliente</dt><dd className="font-medium" data-testid="dtc-client">{item.client || "—"}</dd></div>
            <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Producto</dt><dd className="font-medium" data-testid="dtc-product">{item.product || "—"}</dd></div>
            <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Lote</dt><dd className="font-medium" data-testid="dtc-lote">{item.packagingLote ?? item.loteRef ?? "—"}</dd></div>
            <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Cantidad asignada</dt><dd className="font-medium tabular-nums" data-testid="dtc-assigned">{fmtQty(s?.assigned)}</dd></div>
            <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Ya entregada a Codificado</dt><dd className="font-medium tabular-nums" data-testid="dtc-transferred">{fmtQty(s?.transferred)}</dd></div>
            <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Pendiente de entregar</dt><dd className="font-medium tabular-nums" data-testid="dtc-pending">{fmtQty(s?.pendingToTransfer)}</dd></div>
          </dl>
          <label className="block">
            <span className="text-sm font-medium">Unidades terminadas (total, incluye las ya entregadas)</span>
            <input className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2 tabular-nums" inputMode="numeric" value={finished} onChange={(e) => { edited.current = true; setFinished(e.target.value); }} data-testid="dtc-finished" />
            <span className="mt-1 block text-xs text-[var(--os-text-muted)]">Si todavía no las registraste, cargalas acá: se guardan al confirmar.</span>
          </label>
          <label className="block">
            <span className="text-sm font-medium">Cantidad a entregar ahora *</span>
            <input className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2 tabular-nums" inputMode="numeric" value={qty} onChange={(e) => { edited.current = true; setQty(e.target.value); }} data-testid="dtc-qty" />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Observaciones (opcional)</span>
            <textarea className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
          </label>
          {error ? <p role="alert" className="text-sm text-[var(--genus-error,#b91c1c)]" data-testid="dtc-error">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="primary" disabled={busy || !s} onClick={() => void confirm()} data-testid="dtc-confirm">Confirmar entrega</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
