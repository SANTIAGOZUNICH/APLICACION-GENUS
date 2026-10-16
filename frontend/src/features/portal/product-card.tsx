"use client";

import type { PortalProductView } from "@/lib/portal/overview";
import { days, fmtIsoDay, fmtQty } from "./format";
import { TruckTracker } from "./truck";

export function ProductCard({ product: p, detailHref, compact = false }: { product: PortalProductView; detailHref?: string; compact?: boolean }) {
  const q = p.quantities;
  const showEta = p.countdown && (p.stage === "ELABORACION" || p.stage === "ENVASADO");
  return (
    <article className="gp-card" data-testid="product-card" data-stage={p.stage} aria-label={p.product}>
      <div className="gp-card-head">
        <div>
          <h3>{p.product}</h3>
          <div className="gp-meta">{p.orderRef ? `Pedido ${p.orderRef}` : "Pedido sin número asignado"}</div>
        </div>
        <span className={`gp-pill s-${p.stage}`} data-testid="stage-pill">{p.stageLabel}</span>
      </div>
      <TruckTracker productId={p.id} stageIndex={p.stageIndex} withinPct={p.countdown?.progressPct ?? 0} />
      <p className="gp-message" data-testid="stage-message">{p.message}</p>
      <div className="gp-facts">
        <div className="gp-fact"><span>Cantidad</span><b>{q.mixedUnits ? "Varias unidades" : fmtQty(q.requested, q.unit)}</b></div>
        {!compact ? (
          <>
            <div className="gp-fact"><span>Entregado</span><b>{q.mixedUnits ? "—" : fmtQty(q.delivered, q.unit)}</b></div>
            <div className="gp-fact"><span>{p.stage === "LISTO" ? "Disponible" : "Pendiente"}</span><b>{q.mixedUnits ? "—" : p.stage === "LISTO" ? fmtQty(q.available, q.unit) : fmtQty(q.pending, q.unit)}</b></div>
          </>
        ) : null}
      </div>
      {p.partialDelivery ? (
        <div className="gp-partial" data-testid="partial-note">
          Entrega parcial: solicitado {fmtQty(q.requested, q.unit)} · entregado {fmtQty(q.delivered, q.unit)} · pendiente {fmtQty(q.pending, q.unit)}
          {q.available > 0 ? ` · disponible ${fmtQty(q.available, q.unit)}` : ""}
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
