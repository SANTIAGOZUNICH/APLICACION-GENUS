"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SECTOR_LABELS, type SectorId } from "@/types/operational/sector";
import type { AvailabilityState } from "@/lib/portal/availability-service";

/**
 * «Marcar listo para entregar» — confirmación explícita del ÚLTIMO sector del recorrido (Envasado Masivo/Premium sin
 * Codificado, o Codificado). Actualiza solo el Portal de Clientes: NO registra la entrega física ni toca stock, lotes ni
 * transferencias. El permiso se valida en el servidor; acá solo se decide si mostrar el botón.
 */
const nf = new Intl.NumberFormat("es-AR");
const fmt = (n: number, unit: string | null) => `${nf.format(n)}${unit ? ` ${unit}` : ""}`;
const when = (iso: string) => new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" });
const bareId = (id: string) => id.replace(/^native:/, "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function MarkReadyPanel({ workItemId, orderFallback, onChanged }: { workItemId: string; orderFallback?: string | null; onChanged?: () => void | Promise<void> }) {
  const id = bareId(workItemId);
  const [state, setState] = useState<AvailabilityState | null>(null);
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retract, setRetract] = useState<{ id: string; quantity: number } | null>(null);
  const [reason, setReason] = useState("");
  const keyRef = useRef<string>("");

  const load = useCallback(async () => {
    if (!UUID.test(id)) return;
    try {
      const res = await fetch(`/api/v1/disponibilidad?workItemId=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (res.ok) setState((await res.json()) as AvailabilityState);
      else setState(null);
    } catch {
      setState(null);
    }
  }, [id]);
  useEffect(() => {
    // Carga inicial del estado desde el servidor.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (!UUID.test(id) || !state) return null;
  const hasMarks = state.marks.length > 0;
  if (!state.canMark && !hasMarks) return null;

  function openDialog() {
    keyRef.current = newKey(); // misma clave mientras el diálogo esté abierto: doble clic = una sola confirmación
    setQty(String(state!.maxQuantity));
    setError(null);
    setOpen(true);
  }

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/v1/disponibilidad", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: res.ok, error: data.error ?? "No se pudo completar la operación." };
  }

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post({ action: "mark", workItemId: id, quantity: Number(qty), idempotencyKey: keyRef.current });
      if (!r.ok) return setError(r.error);
      setOpen(false);
      await load();
      await onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function doRetract() {
    if (busy || !retract) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post({ action: "retract", markId: retract.id, reason });
      if (!r.ok) return setError(r.error);
      setRetract(null);
      setReason("");
      await load();
      await onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  const unit = state.unit;
  const sectorLabel = SECTOR_LABELS[state.sector as SectorId] ?? state.sector;
  const q = Number(qty);
  const qtyInvalid = !Number.isFinite(q) || q <= 0 || q > state.maxQuantity;

  return (
    <div className="space-y-2 rounded-[var(--os-radius-sm)] border border-[var(--os-border)] p-3" data-testid="mark-ready-panel">
      <p className="text-xs uppercase text-[var(--os-text-muted)]">Disponibilidad para el cliente</p>
      {hasMarks ? (
        <ul className="space-y-1 text-sm" data-testid="mark-ready-marks">
          {state.marks.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong>{fmt(m.quantity, m.unit)}</strong> marcadas como listas · {m.markedBy} · {when(m.markedAt)}
              </span>
              {m.canRetract ? (
                <button type="button" className="text-xs underline" onClick={() => { setRetract({ id: m.id, quantity: m.quantity }); setReason(""); setError(null); }} data-testid="retract-mark-btn">
                  Retirar disponibilidad
                </button>
              ) : m.retractBlockedReason ? (
                <span className="text-xs text-[var(--os-text-muted)]">{m.retractBlockedReason}</span>
              ) : null}
            </li>
          ))}
          <li className="text-xs text-[var(--os-text-muted)]">
            Disponible ahora: {fmt(state.available, unit)} · entregado: {fmt(state.delivered, unit)}. Marcar como listo no registra la entrega.
          </li>
        </ul>
      ) : null}
      {state.canMark ? (
        <Button variant="primary" onClick={openDialog} data-testid="mark-ready-btn">
          Marcar listo para entregar
        </Button>
      ) : null}

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent data-testid="mark-ready-dialog">
          <DialogHeader>
            <DialogTitle>Marcar listo para entregar</DialogTitle>
          </DialogHeader>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Cliente</dt><dd className="font-medium">{state.client || "—"}</dd></div>
            <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Pedido / orden</dt><dd className="font-medium">{state.orderRef ?? orderFallback ?? "—"}</dd></div>
            <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Producto</dt><dd className="font-medium">{state.product || "—"}</dd></div>
            <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Sector responsable</dt><dd className="font-medium">{sectorLabel}</dd></div>
          </dl>
          <label className="mt-3 block text-sm font-medium" htmlFor="mark-ready-qty">
            Cantidad que se marcará como disponible {unit ? `(${unit})` : ""}
          </label>
          <input
            id="mark-ready-qty"
            type="number"
            inputMode="decimal"
            min={0}
            max={state.maxQuantity}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="mt-1 w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm"
            data-testid="mark-ready-qty"
          />
          <p className="mt-1 text-xs text-[var(--os-text-muted)]">
            Máximo ahora: {fmt(state.maxQuantity, unit)} (terminadas y todavía no marcadas ni entregadas). Si hoy solo hay una parte lista, marcá esa parte; el resto se marca después.
          </p>
          <p className="mt-3 text-sm font-medium">¿Confirmás que este producto está terminado y disponible para entregar al cliente?</p>
          {error ? <p role="alert" className="mt-2 text-sm text-[var(--genus-error)]" data-testid="mark-ready-error">{error}</p> : null}
          <DialogFooter className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy} data-testid="mark-ready-cancel">Cancelar</Button>
            <Button variant="primary" onClick={() => void confirm()} disabled={busy || qtyInvalid} data-testid="mark-ready-confirm">
              {busy ? "Confirmando…" : "Confirmar disponibilidad"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(retract)} onOpenChange={(o) => !busy && !o && setRetract(null)}>
        <DialogContent data-testid="retract-dialog">
          <DialogHeader>
            <DialogTitle>Retirar disponibilidad</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            Vas a retirar {retract ? fmt(retract.quantity, unit) : ""} de «{state.product}». El portal del cliente se actualiza; si ya se le avisó, verá la corrección. No se borra nada: queda registrado quién, cuándo y por qué.
          </p>
          <label className="mt-3 block text-sm font-medium" htmlFor="retract-reason">Motivo</label>
          <textarea id="retract-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm" data-testid="retract-reason" />
          {error ? <p role="alert" className="mt-2 text-sm text-[var(--genus-error)]">{error}</p> : null}
          <DialogFooter className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setRetract(null)} disabled={busy}>Cancelar</Button>
            <Button variant="primary" onClick={() => void doRetract()} disabled={busy || reason.trim().length < 3} data-testid="retract-confirm">Retirar disponibilidad</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
