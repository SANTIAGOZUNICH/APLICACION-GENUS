"use client";

import type { PortalProductView } from "@/lib/portal/overview";
import { days, fmtDateTime, fmtIsoDay, fmtQty } from "./format";
import { TruckTracker } from "./truck";

export function ProductCard({ product: p, detailHref, compact = false }: { product: PortalProductView; detailHref?: string; compact?: boolean }) {
  const q = p.quantities;
  const c = p.commercial;
  const cancelled = c.id === 0;
  const showEta = p.countdown && c.id >= 3 && c.id <= 4;
  const hasFigures = c.id >= 3;
  return (
    <article className="gp-card" data-testid="product-card" data-stage={p.stage} data-status={c.key} aria-label={p.product}>
      <div className="gp-card-head">
        <div>
          <h3>{p.product}</h3>
          <div className="gp-meta">{p.orderRef ? `Pedido ${p.orderRef}` : "Pedido sin número asignado"}{p.orderedAt ? <span data-testid="ordered-at"> · Fecha del pedido: {fmtIsoDay(p.orderedAt)}</span> : null}</div>
        </div>
        <span className={`gp-pill s-${c.key}`} data-testid="stage-pill">{c.label}</span>
      </div>
      {cancelled ? null : <TruckTracker productId={p.id} stageIndex={c.id - 1} withinPct={p.countdown?.progressPct ?? 0} />}
      <p className="gp-message" data-testid="stage-message">{p.message}</p>
      {cancelled || (c.id < 2 && q.requested == null) ? null : (
      <div className="gp-facts" data-testid="facts">
        <div className="gp-fact"><span>Solicitado</span><b>{q.mixedUnits ? "Varias unidades" : fmtQty(q.requested, q.unit)}</b></div>
        {!compact && hasFigures && p.stage !== "ELABORACION" ? <div className="gp-fact" data-testid="fact-available"><span>Disponible</span><b>{q.mixedUnits ? "—" : fmtQty(q.available, q.unit)}</b></div> : null}
        {!compact && c.id >= 2 ? (
          <>
            <div className="gp-fact" data-testid="fact-delivered"><span>Entregado</span><b>{q.mixedUnits ? "—" : fmtQty(q.delivered, q.unit)}</b></div>
            <div className="gp-fact" data-testid="fact-pending"><span>Pendiente</span><b>{q.mixedUnits ? "—" : fmtQty(q.pending, q.unit)}</b></div>
          </>
        ) : null}
      </div>
      )}
      {p.availableSince && q.available > 0 ? (
        <p className="gp-note" data-testid="available-since" style={{ margin: "2px 0 0" }}>Disponible desde el {fmtDateTime(p.availableSince)}</p>
      ) : null}
      {(p.partialDelivery || (q.available > 0 && p.stage !== "LISTO")) && p.stage !== "ENTREGADO" ? (
        <div className="gp-partial" data-testid="partial-note">
          {p.partialDelivery ? "Entrega parcial" : "Disponibilidad parcial"}: solicitado {fmtQty(q.requested, q.unit)} · disponible {fmtQty(q.available, q.unit)} · entregado {fmtQty(q.delivered, q.unit)} · pendiente {fmtQty(q.pending, q.unit)}
        </div>
      ) : null}
      {showEta && p.countdown ? (
        <div className="gp-eta" data-testid="eta">
          <span aria-hidden="true">⏱</span>
          {p.countdown.remainingDays > 0 ? (
            <span>Quedan aprox. <b>{days(p.countdown.remainingDays)}</b> para finalizar esta etapa · estimado {fmtIsoDay(p.countdown.estimatedDate)}</span>
          ) : (
            <span>Esta etapa está <b>por finalizar</b>: el plazo estimado ya se cumplió.</span>
          )}
        </div>
      ) : null}
      <div className="gp-card-foot">
        <span className="gp-note">Tiempos estimativos, pueden variar.</span>
        {detailHref ? <a className="gp-btn gp-btn-primary gp-btn-sm" href={detailHref} data-testid="ver-detalles">Ver detalles</a> : null}
      </div>
    </article>
  );
}
