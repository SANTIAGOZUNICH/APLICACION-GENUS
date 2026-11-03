"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReceivedDelivery } from "@/lib/remitos/delivery-remittance";
import { PrepareRemitoDialog, type PrepareRemitoTarget } from "./prepare-remito-dialog";

const fmt = (n: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(n);
const fmtDate = (iso: string) => new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const SECTORS: Record<string, string> = { ENVASADO_MASIVO: "Envasado Masivo", ENVASADO_PREMIUM: "Envasado Premium", CODIFICADO: "Codificado", ELABORACION: "Elaboración", PRODUCCION: "Producción" };

type Totals = { received: number; remitted: number; available: number; cajas: number };

/** Hook de lectura: entregas a Producción de un trabajo, una por una, con cajas, remitido y disponible. */
export function useReceivedDeliveries(workItemId: string | null, tick = 0) {
  const [data, setData] = useState<{ deliveries: ReceivedDelivery[]; totals: Totals } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!workItemId) return;
    try {
      const res = await fetch(`/api/v1/remitos/deliveries?workItemId=${encodeURIComponent(workItemId.replace(/^native:/, ""))}`, { credentials: "same-origin", cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { deliveries?: ReceivedDelivery[]; totals?: Totals; error?: string };
      if (!res.ok) throw new Error(json.error ?? "No pudimos cargar las entregas.");
      setData({ deliveries: json.deliveries ?? [], totals: json.totals ?? { received: 0, remitted: 0, available: 0, cajas: 0 } });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos cargar las entregas.");
    }
  }, [workItemId]);
  useEffect(() => {
    const t = setTimeout(() => void reload(), 0);
    return () => clearTimeout(t);
  }, [reload, tick]);
  return { data, error, reload };
}

export const toPrepareTarget = (d: ReceivedDelivery): PrepareRemitoTarget => ({
  deliveryLineId: d.deliveryLineId,
  product: d.product,
  client: d.client,
  lote: d.lote,
  sequence: d.sequence,
  sourceLabel: SECTORS[d.sourceSector] ?? d.sourceSector,
  unit: d.unit,
  delivered: d.delivered,
  remitted: d.remitted,
  available: d.available,
  packingGroups: d.packingGroups,
  observations: d.observations,
});

/**
 * Entregas parciales que Producción RECIBIÓ de un trabajo, una por una (no solo el acumulado): sector, fecha, unidades, cajas y su desglose,
 * observaciones, cuánto ya está en remitos y cuánto queda para remitir, con «Preparar remito» por entrega.
 */
export function ReceivedDeliveriesTable({ workItemId, canPrepare, onChanged }: { workItemId: string; canPrepare: boolean; onChanged?: () => void }) {
  const { data, error, reload } = useReceivedDeliveries(workItemId);
  const [prep, setPrep] = useState<PrepareRemitoTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (error && !data) return <p className="text-xs text-[var(--os-text-muted)]" data-testid="rdt-error">{error}</p>;
  if (!data || data.deliveries.length === 0) return null;
  const { deliveries, totals } = data;
  return (
    <section className="space-y-2" data-testid="received-deliveries">
      <p className="text-xs uppercase text-[var(--os-text-muted)]">Entregas recibidas por Producción</p>
      <p className="rounded bg-white/5 px-3 py-2 text-sm" data-testid="rdt-totals">
        Total recibido: <strong>{fmt(totals.received)} u.</strong>{totals.cajas > 0 ? ` en ${totals.cajas} ${totals.cajas === 1 ? "caja" : "cajas"}` : ""} · Total remitido: <strong>{fmt(totals.remitted)} u.</strong> · Disponible para remitir: <strong>{fmt(totals.available)} u.</strong>
      </p>
      {notice ? <p role="status" className="text-sm text-emerald-300" data-testid="rdt-notice">{notice}</p> : null}
      <div className="overflow-x-auto rounded border border-[var(--os-border)]">
        <table className="w-full min-w-[820px] text-left text-xs">
          <thead className="text-[var(--os-text-muted)]"><tr><th className="px-2 py-2">Entrega</th><th className="px-2 py-2">Sector</th><th className="px-2 py-2">Fecha</th><th className="px-2 py-2 text-right">Unidades</th><th className="px-2 py-2">Cajas</th><th className="px-2 py-2">Observaciones</th><th className="px-2 py-2 text-right">En remitos</th><th className="px-2 py-2 text-right">Disponible</th><th className="px-2 py-2" /></tr></thead>
          <tbody>
            {deliveries.map((d) => (
              <tr key={d.deliveryLineId} className="border-t border-[var(--os-border)] align-top" data-testid="rdt-row" data-line-id={d.deliveryLineId}>
                <td className="px-2 py-2 font-medium">Parcial {d.sequence}</td>
                <td className="px-2 py-2">{SECTORS[d.sourceSector] ?? d.sourceSector}</td>
                <td className="whitespace-nowrap px-2 py-2">{fmtDate(d.deliveredAt)}</td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums" data-testid="rdt-qty">{fmt(d.delivered)}</td>
                <td className="max-w-[220px] px-2 py-2" data-testid="rdt-boxes">{d.boxesText ?? <span className="text-[var(--os-text-muted)]">Sin detalle de cajas</span>}{d.packingSource === "TRABAJO" ? <span className="block text-[var(--os-text-muted)]">(informadas por Envasado)</span> : null}</td>
                <td className="max-w-[200px] whitespace-pre-wrap px-2 py-2">{d.observations || "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums" data-testid="rdt-remitted">{fmt(d.mark === "REMITO_EXTERNO" ? d.delivered : d.remitted)}{d.remitos.length > 0 ? <span className="block text-[var(--os-text-muted)]">{d.remitos.map((r) => r.number ?? "borrador").join(", ")}</span> : null}{d.mark ? <span className="block text-[var(--os-text-muted)]">{d.mark === "REMITO_EXTERNO" ? "remito externo" : "quitada de pendientes"}</span> : null}</td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums" data-testid="rdt-available">{fmt(d.available)}</td>
                <td className="px-2 py-2 text-right">
                  {canPrepare && d.available > 1e-6 ? <button type="button" className="min-h-9 rounded border border-[var(--os-border)] px-2 text-xs font-medium" onClick={() => setPrep(toPrepareTarget(d))} data-testid="rdt-prepare">Preparar remito</button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {prep ? <PrepareRemitoDialog target={prep} onClose={() => setPrep(null)} onDone={(m) => { setPrep(null); setNotice(m); void reload(); onChanged?.(); }} /> : null}
    </section>
  );
}
