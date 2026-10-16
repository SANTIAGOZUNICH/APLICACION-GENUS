"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PortalDeliveryView, PortalOverviewData, PortalProductView } from "@/lib/portal/overview";
import type { PortalNotificationView } from "@/lib/portal/data-service";
import { fmtDate, fmtDateTime, fmtQty } from "./format";
import { ProductCard } from "./product-card";
import { ReceiptDialog } from "./receipt-dialog";
import { PortalHeader } from "./shell";

export type ClientPayload = Omit<PortalOverviewData, "ready"> & { client: { name: string; code: string }; notifications: PortalNotificationView[]; demo?: boolean };
export type Contact = { email: string; whatsappUrl: string; whatsappLabel: string };

/** Banner discreto del modo demostración: avisa que los datos son ficticios y permite reiniciar la simulación. */
export function DemoBanner({ onReset }: { onReset: () => void }) {
  const [busy, setBusy] = useState(false);
  async function reset() {
    setBusy(true);
    try {
      await fetch("/entregas/api/demo/reset", { method: "POST", credentials: "same-origin" });
      onReset();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="gp-demo-banner" role="note" data-testid="demo-banner">
      <span>Estás viendo datos <b>ficticios</b> de demostración. Nada de lo que hagas acá afecta a GENUS OS ni a clientes reales.</span>
      <button type="button" className="gp-link-btn" onClick={() => void reset()} disabled={busy} data-testid="demo-reset">Reiniciar demostración</button>
    </div>
  );
}

export async function logout() {
  try {
    await fetch("/entregas/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } finally {
    window.location.assign("/entregas");
  }
}

/** Hook compartido: datos del cliente con refresco al volver a la pestaña y cada 60 s. Sesión vencida → login. */
export function usePortalData(initial: ClientPayload) {
  const [data, setData] = useState(initial);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/entregas/api/overview", { credentials: "same-origin", cache: "no-store" });
      if (res.status === 401) {
        window.location.assign("/entregas");
        return;
      }
      if (res.ok) setData((await res.json()) as ClientPayload);
    } catch {
      /* sin conexión: se conservan los datos ya cargados */
    }
  }, []);
  useEffect(() => {
    const t = setInterval(() => void refresh(), 60_000);
    const onVis = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);
  return { data, refresh };
}

function Bell({ notifications, onRead }: { notifications: PortalNotificationView[]; onRead: () => void }) {
  const [open, setOpen] = useState(false);
  const unread = notifications.filter((n) => !n.read).length;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread) {
      await fetch("/entregas/api/notifications", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
      onRead();
    }
  }
  return (
    <div className="gp-relative" ref={box}>
      <button className="gp-icon-btn" aria-label={`Notificaciones${unread ? `, ${unread} sin leer` : ""}`} aria-expanded={open} onClick={toggle} data-testid="bell">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9M10 20a2 2 0 0 0 4 0" /></svg>
        {unread ? <span className="gp-badge-dot" data-testid="bell-count">{unread}</span> : null}
      </button>
      {open ? (
        <div className="gp-pop" role="region" aria-label="Notificaciones">
          {notifications.length === 0 ? <div className="gp-empty">Todavía no tenés notificaciones.</div> : (
            <ul className="gp-list">
              {notifications.map((n) => (
                <li key={n.id} className={`gp-row${n.read ? "" : " unread"}`}><div><b>{n.title}</b><div className="gp-meta">{n.body}</div><div className="gp-note">{fmtDateTime(n.createdAt)}</div></div></li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function DeliveryRow({ d, onConfirm }: { d: PortalDeliveryView; onConfirm: (id: string) => void }) {
  return (
    <li className="gp-row" data-testid="delivery-row">
      <div>
        <b>{d.product}</b>
        <div className="gp-meta">{d.orderRef ? `Pedido ${d.orderRef} · ` : ""}{fmtQty(d.quantity, d.unit)} · entregado el {fmtDate(d.deliveredAt)}</div>
        {d.confirmation ? <div className="gp-stamp" data-testid="delivery-confirmed">Recepción confirmada el {fmtDateTime(d.confirmation.at)}</div> : null}
      </div>
      {d.canConfirm ? <button className="gp-btn gp-btn-primary gp-btn-sm" onClick={() => onConfirm(d.id)} data-testid="confirm-receipt">Confirmar recepción</button> : null}
    </li>
  );
}

export function Dashboard({ initial, contact }: { initial: ClientPayload; contact: Contact }) {
  const { data, refresh } = usePortalData(initial);
  const [dialog, setDialog] = useState<string | null>(null);
  const [localRead, setLocalRead] = useState(false);
  const s = data.summary;
  const notifications = localRead ? data.notifications.map((n) => ({ ...n, read: true })) : data.notifications;
  const products: PortalProductView[] = data.products;

  return (
    <>
      <PortalHeader
        demo={data.demo}
        right={
          <>
            <Bell notifications={notifications} onRead={() => setLocalRead(true)} />
            <button className="gp-btn gp-btn-ghost gp-btn-sm" onClick={() => void logout()} data-testid="logout">{data.demo ? "Salir de la demo" : "Salir"}</button>
          </>
        }
      />
      <main className="gp-wrap" id="contenido">
        {data.demo ? <DemoBanner onReset={() => void refresh()} /> : null}
        <section className="gp-hero">
          <h1 data-testid="welcome">Hola, {data.client.name}</h1>
          <p><span className="gp-tagline">Tu producción, en buenas manos.</span>{data.demo ? "" : ` Código de cliente ${data.client.code}`}</p>
        </section>

        <section className="gp-summary" aria-label="Resumen">
          <div className="gp-tile"><b data-testid="sum-process">{s.inProcess}</b><span>En proceso</span></div>
          <div className="gp-tile"><b data-testid="sum-elab">{s.elaboracion}</b><span>En elaboración</span></div>
          <div className="gp-tile"><b data-testid="sum-env">{s.envasado}</b><span>En envasado</span></div>
          <div className="gp-tile is-ready"><b data-testid="sum-ready">{s.listos}</b><span>Listos para entregar</span></div>
        </section>

        <section className="gp-section" aria-labelledby="gp-prod">
          <h2 id="gp-prod">Tus productos</h2>
          {products.length === 0 ? (
            <div className="gp-empty" data-testid="no-products">Por ahora no tenés producciones en curso. Cuando haya novedades, las vas a ver acá.</div>
          ) : (
            <div className="gp-grid">{products.map((p) => <ProductCard key={p.id} product={p} detailHref={`/entregas/producto/${p.id}`} />)}</div>
          )}
        </section>

        <div className="gp-section gp-two">
          <section aria-labelledby="gp-hist">
            <h2 id="gp-hist" style={{ fontSize: 20, marginBottom: 14 }}>Historial de entregas</h2>
            {data.deliveries.length === 0 ? <div className="gp-empty">Todavía no registramos entregas.</div> : (
              <ul className="gp-list">{data.deliveries.map((d) => <DeliveryRow key={d.id} d={d} onConfirm={setDialog} />)}</ul>
            )}
          </section>
          <section aria-labelledby="gp-contact">
            <h2 id="gp-contact" style={{ fontSize: 20, marginBottom: 14 }}>Contacto</h2>
            <div className="gp-card gp-contact">
              <p style={{ margin: 0 }}>¿Querés coordinar una entrega o tenés una consulta? Escribinos:</p>
              <a href={`mailto:${contact.email}`} data-testid="contact-email">{contact.email}</a>
              <a href={contact.whatsappUrl} target="_blank" rel="noopener noreferrer">WhatsApp {contact.whatsappLabel}</a>
            </div>
          </section>
        </div>

        <footer className="gp-footer" data-testid="disclaimer">{data.disclaimer}</footer>
      </main>
      {dialog ? <ReceiptDialog demo={data.demo} deliveryId={dialog} onClose={() => setDialog(null)} onConfirmed={() => void refresh()} /> : null}
    </>
  );
}
