"use client";

import { useCallback, useEffect, useState } from "react";
import type { InternalDeliveryDto } from "@/lib/planning/internal-deliveries-service";

const fmt = (n: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(n);
const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

/** Entregas a Producción de un trabajo (las que ve el sector que consulta), una por una. Solo lectura. */
export function useWorkDeliveries(workItemId: string | null, tick = 0) {
  const [items, setItems] = useState<InternalDeliveryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!workItemId) return;
    try {
      const res = await fetch(`/api/v1/internal-deliveries?workItemId=${encodeURIComponent(workItemId.replace(/^native:/, ""))}`, { credentials: "same-origin", cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { items?: InternalDeliveryDto[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "No pudimos cargar las entregas.");
      setItems((json.items ?? []).filter((i) => i.kind === "PRODUCCION"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos cargar las entregas.");
    }
  }, [workItemId]);
  useEffect(() => {
    const t = setTimeout(() => void reload(), 0);
    return () => clearTimeout(t);
  }, [reload, tick]);
  return { items, error, reload };
}

/**
 * «Entregas a Producción» de un trabajo: cada entrega parcial por separado (n.º, fecha, unidades, cajas y su desglose, observaciones,
 * estado) y el total entregado (las canceladas no suman). Mismos datos que ve Producción en «Entregas internas».
 */
export function WorkDeliveriesList({ workItemId, tick = 0 }: { workItemId: string; tick?: number }) {
  const { items, error } = useWorkDeliveries(workItemId, tick);
  if (error && !items) return <p className="text-xs text-[var(--os-text-muted)]" data-testid="wd-error">{error}</p>;
  if (!items || items.length === 0) return null;
  const active = items.filter((i) => i.status === "ACTIVA");
  const units = active.reduce((s, i) => s + i.quantity, 0);
  const cajas = active.reduce((s, i) => s + i.cajas, 0);
  return (
    <section className="space-y-2 rounded border border-[var(--os-border)] p-3 text-sm" data-testid="wd-list" aria-label="Entregas a Producción">
      <h4 className="text-xs font-semibold uppercase text-[var(--os-text-muted)]">Entregas a Producción</h4>
      <p className="text-xs" data-testid="wd-total">
        Total entregado: <strong>{fmt(units)} u.</strong>
        {cajas > 0 ? ` en ${cajas} ${cajas === 1 ? "caja" : "cajas"}` : ""} · {active.length} {active.length === 1 ? "entrega" : "entregas"}
      </p>
      <ul className="space-y-1">
        {items.map((d) => (
          <li key={d.id} className={`rounded border border-[var(--os-border)] px-2 py-1.5 text-xs ${d.status === "ACTIVA" ? "" : "opacity-60"}`} data-testid="wd-row" data-line-id={d.id} data-status={d.status}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">Entrega {d.sequence} · {fmtDate(d.date)}</span>
              <span className="tabular-nums font-semibold" data-testid="wd-qty">{fmt(d.quantity)} u.</span>
            </div>
            <div data-testid="wd-boxes">{d.boxesText ?? <span className="text-[var(--os-text-muted)]">Sin detalle de cajas</span>}{d.packingInherited ? <span className="text-[var(--os-text-muted)]"> (informadas por Envasado)</span> : null}</div>
            {d.observations ? <div className="text-[var(--os-text-muted)]">{d.observations}</div> : null}
            {d.status !== "ACTIVA" ? <div className="font-medium">Cancelada{d.cancelReason ? ` · ${d.cancelReason}` : ""}</div> : null}
            {d.remitos.length > 0 ? <div className="text-[var(--os-text-muted)]">En remito: {d.remitos.map((r) => r.number ?? "borrador").join(", ")}</div> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
