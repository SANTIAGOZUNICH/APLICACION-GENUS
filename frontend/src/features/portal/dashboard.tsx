"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAutoSync } from "@/features/os/operational/lib/use-auto-sync";
import type { PortalDeliveryView, PortalOrderView, PortalOverviewData, PortalProductView } from "@/lib/portal/overview";
import type { PortalNotificationView } from "@/lib/portal/data-service";
import { fmtDate, fmtDateTime, fmtQty } from "./format";
import { ProductCard } from "./product-card";
import { ReceiptDialog } from "./receipt-dialog";
import { PortalHeader } from "./shell";
import { AppPanel } from "./pwa/app-panel";
import { PushPrompt } from "./pwa/push-prompt";
import { usePushState } from "./pwa/use-push-state";
import { cleanupOnLogout, type PushHistoryItem } from "./pwa/push-client";
import { usePushInbox } from "./pwa/use-push-inbox";

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

/** Un pedido con todos sus productos: estado del pedido, progreso por producto y una tarjeta por producto. */
export function OrderBlock({ order: o, products }: { order: PortalOrderView; products: PortalProductView[] }) {
  return (
    <article className="gp-order" id={`pedido-${o.id}`} data-testid="order" data-status={o.status.key} aria-label={o.orderRef ? `Pedido ${o.orderRef}` : "Pedido"}>
      <header className="gp-order-head">
        <div>
          <h3>{o.orderRef ? `Pedido ${o.orderRef}` : "Pedido sin número asignado"}</h3>
          <div className="gp-meta" data-testid="order-progress">{o.progress.total > 1 || o.partial ? o.progressText : `${products.length} ${products.length === 1 ? "producto" : "productos"}`}</div>
          {o.deliveredAt ? <div className="gp-meta" data-testid="order-delivered-at">Entregado el {fmtDate(o.deliveredAt)}</div> : null}
        </div>
        <span className={`gp-pill s-${o.status.key}`} data-testid="order-status">{o.status.label}</span>
      </header>
      <p className="gp-message" data-testid="order-message">{o.message}</p>
      <div className="gp-grid">{products.map((p) => <ProductCard key={p.id} product={p} detailHref={`/entregas/producto/${p.id}`} />)}</div>
    </article>
  );
}

export async function logout() {
  try {
    await cleanupOnLogout();
    await fetch("/entregas/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } finally {
    window.location.assign("/entregas");
  }
}

/** Cada cuántos segundos se consulta si hubo novedades (solo con la pestaña visible; al volver a ella se consulta en el acto). 5 s: la consulta es un 304 sin cuerpo si nada cambió. */
export const PORTAL_POLL_MS = 5_000;

/**
 * Hook compartido: datos del cliente SIN recargar la página. Reutiliza `useAutoSync` de GENUS OS (solo lectura; pausado en segundo
 * plano; al volver a la pestaña, al recuperar conexión o al enfocar la ventana consulta enseguida; no pisa un diálogo abierto).
 * La consulta es liviana: manda `If-None-Match` con la firma de lo último recibido y el servidor responde 304 si nada cambió.
 * Solo se vuelve a renderizar si los datos cambiaron. Sesión vencida → login.
 */
export function usePortalData(initial: ClientPayload) {
  const [data, setData] = useState(initial);
  const etag = useRef<string | null>(null);
  const run = useCallback(async () => {
    const res = await fetch("/entregas/api/overview", { credentials: "same-origin", cache: "no-store", headers: etag.current ? { "If-None-Match": etag.current } : {} });
    if (res.status === 304) return;
    if (res.status === 401 || res.status === 403) {
      window.location.assign("/entregas");
      return;
    }
    if (!res.ok) throw new Error("No se pudo actualizar: se reintenta solo.");
    etag.current = res.headers.get("ETag");
    const next = (await res.json()) as ClientPayload;
    setData((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, []);
  const sync = useAutoSync({ intervalMs: PORTAL_POLL_MS, run });
  const { syncNow } = sync;
  const refresh = useCallback(async () => {
    etag.current = null;
    await syncNow(true);
  }, [syncNow]);
  return { data, refresh, lastSyncAt: sync.lastSyncAt, syncError: sync.error };
}

function Bell({ notifications, onRead, push, onPushRead }: { notifications: PortalNotificationView[]; onRead: () => void; push: PushHistoryItem[]; onPushRead: (ids: string[] | "all") => void }) {
  const [open, setOpen] = useState(false);
  const pushUnread = push.filter((n) => !n.read).length;
  const unread = notifications.filter((n) => !n.read).length + pushUnread;
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
    if (next && notifications.some((n) => !n.read)) {
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
          {pushUnread > 0 ? <button type="button" className="gp-link-btn gp-pop-all" onClick={() => onPushRead("all")} data-testid="push-read-all">Marcar todas como leídas</button> : null}
          {notifications.length === 0 && push.length === 0 ? <div className="gp-empty">Todavía no tenés notificaciones.</div> : (
            <ul className="gp-list">
              {push.map((n) => (
                <li key={`push-${n.id}`} className={`gp-row${n.read ? " read" : " unread"}`} data-testid="push-item" data-read={n.read ? "1" : "0"}>
                  <a href={n.url} onClick={() => { if (!n.read) onPushRead([n.id]); setOpen(false); }} style={{ color: "inherit", textDecoration: "none" }}>
                    <b>{n.title}</b><div className="gp-meta" style={{ whiteSpace: "pre-line" }}>{n.body}</div><div className="gp-note">{fmtDateTime(n.createdAt)}</div>
                  </a>
                </li>
              ))}
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
  const { data, refresh, lastSyncAt, syncError } = usePortalData(initial);
  const push = usePushState();
  const [dialog, setDialog] = useState<string | null>(null);
  const [localRead, setLocalRead] = useState(false);
  const inbox = usePushInbox(!data.demo);
  const s = data.summary;
  // Al tocar una notificación se abre el pedido (#pedido-<id>): se lo muestra y resalta, también si la app ya estaba abierta.
  useEffect(() => {
    const go = () => {
      const h = window.location.hash;
      if (!h.startsWith("#pedido-")) return;
      const el = document.getElementById(h.slice(1));
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("gp-order-focus");
      window.setTimeout(() => el.classList.remove("gp-order-focus"), 4000);
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [data.orders.length]);
  const notifications = localRead ? data.notifications.map((n) => ({ ...n, read: true })) : data.notifications;
  const products: PortalProductView[] = data.products;
  // Los pedidos ENTREGADOS no desaparecen: quedan en su propia sección «Entregados» (con la fecha de entrega) como historial.
  const activeOrders = data.orders.filter((o) => o.status.id !== 6);
  const deliveredOrders = data.orders.filter((o) => o.status.id === 6);

  return (
    <>
      <PortalHeader
        demo={data.demo}
        right={
          <>
            <Bell notifications={notifications} onRead={() => setLocalRead(true)} push={inbox.items} onPushRead={(ids) => void inbox.read(ids)} />
            <button className="gp-btn gp-btn-ghost gp-btn-sm" onClick={() => void logout()} data-testid="logout">Salir</button>
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

        <p className="gp-note gp-sync" data-testid="sync-status" data-state={syncError ? "error" : lastSyncAt ? "ok" : "idle"} role="status" aria-live="polite">
          {syncError ? `Sin conexión: mostramos lo último que recibimos (${syncError})` : lastSyncAt ? `Actualizado ${lastSyncAt.toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour12: false, hour: "2-digit", minute: "2-digit" })} h · se actualiza solo` : "Se actualiza solo"}
        </p>

<section className="gp-section" aria-labelledby="gp-prod">
          <h2 id="gp-prod">Tus pedidos</h2>
          {products.length === 0 ? (
            <div className="gp-empty" data-testid="no-products">Por ahora no tenés producciones en curso. Cuando haya novedades, las vas a ver acá.</div>
          ) : activeOrders.length === 0 ? (
            <div className="gp-empty" data-testid="no-active-orders">No tenés pedidos en curso. Tus pedidos entregados están más abajo.</div>
          ) : (
            <div className="gp-orders">
              {activeOrders.map((o) => <OrderBlock key={o.id} order={o} products={products.filter((p) => o.productIds.includes(p.id))} />)}
            </div>
          )}
        </section>

        {deliveredOrders.length > 0 ? (
          <section className="gp-section" aria-labelledby="gp-delivered" data-testid="delivered-section">
            <h2 id="gp-delivered">Entregados</h2>
            <div className="gp-orders">
              {deliveredOrders.map((o) => <OrderBlock key={o.id} order={o} products={products.filter((p) => o.productIds.includes(p.id))} />)}
            </div>
          </section>
        ) : null}

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

        {data.demo ? null : <div className="gp-section"><AppPanel push={push} /></div>}
        {data.demo ? null : <PushPrompt push={push} scope={data.client.code} />}

        <footer className="gp-footer" data-testid="disclaimer">{data.disclaimer}</footer>
      </main>
      {dialog ? <ReceiptDialog demo={data.demo} deliveryId={dialog} onClose={() => setDialog(null)} onConfirmed={() => void refresh()} /> : null}
    </>
  );
}
