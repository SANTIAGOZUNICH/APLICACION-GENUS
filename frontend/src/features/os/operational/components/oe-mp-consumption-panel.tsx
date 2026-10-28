"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchOeMpConsumptionApi, type OeMpConsumptionRow } from "@/lib/orders/orders-client";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import { buildConsumptionView, fmtKg } from "@/lib/orders/oe-mp-consumption-view";
import type { OeMaterialRow } from "@/lib/orders/types";

/**
 * «Consumo de Materias Primas» de una OE: lo que se descontó del inventario por cada MP (código / lote), con el stock anterior,
 * el consumo (con signo negativo) y el stock restante — en rojo si quedó negativo — y, aparte, lo que solo está previsto o
 * pendiente de registrar. Lee el libro mayor de Stock MP: son los movimientos reales, no una copia.
 */
export function OeMpConsumptionPanel({
  session,
  orderId,
  materials,
  refreshKey,
}: {
  session: OrdersClientSession;
  orderId: string;
  materials: OeMaterialRow[];
  /** Cambia cuando se guarda/entrega: vuelve a leer los movimientos. */
  refreshKey: unknown;
}) {
  const [state, setState] = useState<{ rows: OeMpConsumptionRow[] | null; error: string | null }>({ rows: null, error: null });
  useEffect(() => {
    let cancelled = false;
    fetchOeMpConsumptionApi(session, orderId)
      .then((rows) => !cancelled && setState({ rows, error: null }))
      .catch((e) => !cancelled && setState((p) => ({ rows: p.rows, error: e instanceof Error ? e.message : "No se pudo leer el consumo." })));
    return () => {
      cancelled = true;
    };
  }, [session, orderId, refreshKey]);
  const view = useMemo(() => buildConsumptionView(state.rows ?? [], materials), [state.rows, materials]);
  const negatives = view.filter((r) => r.negativo);
  if (state.rows === null && !state.error) return null;
  if (view.length === 0 && !state.error) return null;

  return (
    <section className="space-y-2 rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm" data-testid="oe-mp-consumo">
      <h3 className="font-semibold">Consumo de Materias Primas</h3>
      {state.error ? <p className="text-xs text-rose-800">{state.error}</p> : null}
      {negatives.length > 0 ? (
        <p className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-900" role="status" data-testid="oe-mp-consumo-negativo">
          Stock negativo: {negatives.map((n) => `${n.codigo} (${fmtKg(n.stockDespues)})`).join(" · ")}. El consumo se descontó igual; el saldo se corrige al ingresar stock.
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-xs">
          <thead className="text-[var(--os-text-muted)]">
            <tr>
              <th className="py-1 pr-2">Materia prima</th>
              <th className="py-1 pr-2">Código / Lote</th>
              <th className="py-1 pr-2 text-right">Stock anterior</th>
              <th className="py-1 pr-2 text-right">Consumo OE</th>
              <th className="py-1 pr-2 text-right">Stock restante</th>
              <th className="py-1">Estado</th>
            </tr>
          </thead>
          <tbody>
            {view.map((r) => (
              <tr key={r.key} className="border-t border-[var(--os-border-subtle)]" data-testid="oe-mp-consumo-row" data-estado={r.estado}>
                <td className="py-1 pr-2">{r.materiaPrima}</td>
                <td className="py-1 pr-2">
                  {r.codigo}
                  {r.lote ? ` / ${r.lote}` : ""}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{r.estado === "confirmado" ? fmtKg(r.stockAntes) : "—"}</td>
                <td className={`py-1 pr-2 text-right tabular-nums ${r.estado === "confirmado" ? "font-medium" : "text-[var(--os-text-muted)]"}`}>
                  {r.estado === "confirmado" ? fmtKg(-r.kg, { signed: true }) : `(${fmtKg(r.kg)})`}
                </td>
                <td className={`py-1 pr-2 text-right tabular-nums ${r.negativo ? "font-semibold text-rose-700" : ""}`} data-testid={r.negativo ? "oe-mp-consumo-saldo-negativo" : undefined}>
                  {r.estado === "confirmado" ? fmtKg(r.stockDespues) : "—"}
                </td>
                <td className="py-1">
                  {r.estado === "confirmado" ? (
                    <span title={`${r.at ? new Date(r.at).toLocaleString("es-AR") : ""} · ${r.actorEmail ?? ""}`}>Descontado{r.negativo ? " · stock negativo" : ""}</span>
                  ) : r.estado === "pendiente" ? (
                    <span className="text-amber-800">Pendiente de registrar</span>
                  ) : (
                    <span className="text-[var(--os-text-muted)]">Previsto (aún no descontado)</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-[var(--os-text-muted)]">Se descuenta el KG REAL UTILIZADO, una sola vez; si lo corregís se registra solo la diferencia. Los movimientos también figuran en el historial de Stock MP.</p>
    </section>
  );
}
