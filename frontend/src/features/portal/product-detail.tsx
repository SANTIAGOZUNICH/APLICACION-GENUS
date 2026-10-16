"use client";

import { useState } from "react";
import type { PortalProductView } from "@/lib/portal/overview";
import { logout, usePortalData, type ClientPayload, type Contact } from "./dashboard";
import { fmtDate, fmtDateTime, fmtQty } from "./format";
import { ProductCard } from "./product-card";
import { ReceiptDialog } from "./receipt-dialog";
import { PortalHeader } from "./shell";


export function ProductDetail({ initial, productId, contact }: { initial: ClientPayload; productId: string; contact: Contact }) {
  const { data, refresh } = usePortalData(initial);
  const [dialog, setDialog] = useState<string | null>(null);
  const p: PortalProductView | undefined = data.products.find((x) => x.id === productId);
  return (
    <>
      <PortalHeader right={<button className="gp-btn gp-btn-ghost gp-btn-sm" onClick={() => void logout()}>Salir</button>} />
      <main className="gp-wrap">
        <a className="gp-back" href="/entregas" data-testid="back">← Volver a mis productos</a>
        {!p ? (
          <div className="gp-empty" style={{ marginTop: 18 }}>Este producto ya no está disponible en tu portal.</div>
        ) : (
          <div className="gp-section gp-two" style={{ marginTop: 18 }}>
            <div>
              <ProductCard product={p} />
              <div className="gp-card" style={{ marginTop: 18 }}>
                <h3 style={{ marginBottom: 6 }}>Entregas de este producto</h3>
                {p.deliveries.length === 0 ? <p className="gp-meta">Todavía no hay entregas registradas.</p> : (
                  <ul className="gp-list" style={{ marginTop: 10 }}>
                    {p.deliveries.map((d) => (
                      <li key={d.id} className="gp-row" data-testid="delivery-row">
                        <div>
                          <b>{fmtQty(d.quantity, d.unit)}</b>
                          <div className="gp-meta">Entregado el {fmtDate(d.deliveredAt)}</div>
                          {d.confirmation ? <div className="gp-stamp">Recepción confirmada el {fmtDateTime(d.confirmation.at)}</div> : null}
                        </div>
                        {d.canConfirm ? <button className="gp-btn gp-btn-primary gp-btn-sm" onClick={() => setDialog(d.id)} data-testid="confirm-receipt">Confirmar recepción</button> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="gp-card">
              <h3>Recorrido</h3>
              <ol className="gp-steps" data-testid="timeline">
                {p.timeline.map((t) => (
                  <li key={t.stage} className={`gp-step ${t.state}`}>
                    <i className="gp-dot" />
                    <div><b>{t.label}</b><span>{t.date ? `Desde el ${fmtDate(t.date)}` : t.state === "upcoming" ? "Pendiente" : "Fecha no disponible"}</span></div>
                  </li>
                ))}
              </ol>
              <p className="gp-note" style={{ marginTop: 16 }}>{data.disclaimer}</p>
              <p className="gp-meta">Consultas: <a href={`mailto:${contact.email}`}>{contact.email}</a></p>
            </div>
          </div>
        )}
      </main>
      {dialog ? <ReceiptDialog deliveryId={dialog} onClose={() => setDialog(null)} onConfirmed={() => void refresh()} /> : null}
    </>
  );
}
