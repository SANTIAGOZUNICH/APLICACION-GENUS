"use client";

import { useEffect, useRef, useState } from "react";
import type { PortalDeliveryView } from "@/lib/portal/overview";
import { fmtDate, fmtDateTime, fmtQty } from "./format";

type Confirmation = { confirmedAt: string; product: string; orderRef: string | null; quantity: number | null; unit: string | null; deliveredAt: string };

/** «Confirmar recepción»: solo para entregas finales registradas por GENUS OS. Muestra el detalle y recién confirma al aceptar. */
export function ReceiptDialog({ deliveryId, onClose, onConfirmed }: { deliveryId: string; onClose: () => void; onConfirmed: () => void }) {
  const [delivery, setDelivery] = useState<PortalDeliveryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Confirmation | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/entregas/api/receipt?id=${encodeURIComponent(deliveryId)}`, { credentials: "same-origin", cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, json: (await r.json().catch(() => ({}))) as { delivery?: PortalDeliveryView; error?: string } }))
      .then((r) => {
        if (!alive) return;
        if (r.ok && r.json.delivery) setDelivery(r.json.delivery);
        else setError(r.json.error ?? "No encontramos esa entrega.");
      })
      .catch(() => alive && setError("No hay conexión. Probá de nuevo."));
    return () => {
      alive = false;
    };
  }, [deliveryId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/entregas/api/receipt", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ id: deliveryId }) });
      const json = (await res.json().catch(() => ({}))) as { confirmation?: Confirmation; error?: string };
      if (res.ok && json.confirmation) {
        setDone(json.confirmation);
        onConfirmed();
      } else setError(json.error ?? "No pudimos confirmar la recepción.");
      if (res.status === 409) onConfirmed();
    } catch {
      setError("No hay conexión. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gp-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="gp-dialog" role="dialog" aria-modal="true" aria-labelledby="gp-rcpt-title" tabIndex={-1} ref={ref} data-testid="receipt-dialog">
        {done ? (
          <>
            <h2 id="gp-rcpt-title">Recepción confirmada</h2>
            <p className="gp-stamp" data-testid="receipt-stamp">Constancia registrada el {fmtDateTime(done.confirmedAt)}</p>
            <dl className="gp-dl">
              <div><dt>Producto</dt><dd>{done.product}</dd></div>
              {done.orderRef ? <div><dt>Pedido</dt><dd>{done.orderRef}</dd></div> : null}
              <div><dt>Cantidad recibida</dt><dd>{fmtQty(done.quantity, done.unit)}</dd></div>
              <div><dt>Fecha de entrega registrada</dt><dd>{fmtDate(done.deliveredAt)}</dd></div>
            </dl>
            <p className="gp-note">Avisamos a nuestro equipo de Producción. ¡Gracias por confiar en Laboratorio Genus!</p>
            <div className="gp-dialog-actions" style={{ marginTop: 16 }}><button className="gp-btn gp-btn-primary" onClick={onClose}>Cerrar</button></div>
          </>
        ) : (
          <>
            <h2 id="gp-rcpt-title">Confirmar recepción</h2>
            {delivery ? (
              <dl className="gp-dl">
                <div><dt>Producto</dt><dd>{delivery.product}</dd></div>
                <div><dt>Pedido</dt><dd>{delivery.orderRef ?? "—"}</dd></div>
                <div><dt>Cantidad recibida</dt><dd>{fmtQty(delivery.quantity, delivery.unit)}</dd></div>
                <div><dt>Fecha de entrega registrada</dt><dd>{fmtDate(delivery.deliveredAt)}</dd></div>
              </dl>
            ) : error ? null : <p className="gp-meta">Cargando…</p>}
            {error ? <div className="gp-msg err" role="alert" data-testid="receipt-error">{error}</div> : null}
            <p className="gp-note" style={{ marginBottom: 14 }}>Al confirmar, queda registrada la fecha y hora en que recibiste este producto.</p>
            <div className="gp-dialog-actions">
              <button className="gp-btn gp-btn-ghost" onClick={onClose} disabled={busy}>CANCELAR</button>
              <button className="gp-btn gp-btn-primary" onClick={confirm} disabled={busy || !delivery}>{busy ? "Confirmando…" : "CONFIRMAR RECEPCIÓN"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
