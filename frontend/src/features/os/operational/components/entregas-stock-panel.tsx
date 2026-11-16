"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { applyHistoricoDespachosApi, assignDespachoMaterialApi, fetchDespachoStockReportApi, type DespachoStockReport } from "@/lib/despachos/despachos-client";
import type { OrdersClientSession } from "@/lib/orders/orders-client";

const fmt = (n: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(n);

/**
 * Vínculo Entregas Producción ↔ stock ME. Cada entrega descuenta UNA salida del inventario: acá se ve cuáles ya descuentan, cuáles
 * necesitan elegir material (no se inventa nada) y se puede aplicar —de forma explícita— el descuento a las entregas históricas.
 */
export function EntregasStockPanel({ session, canEdit, refreshKey, onChanged, notify }: { session: OrdersClientSession; canEdit: boolean; refreshKey: number; onChanged: () => void; notify: (msg: string) => void }) {
  const [report, setReport] = useState<DespachoStockReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setReport(await fetchDespachoStockReportApi(session));
    } catch {
      setReport(null);
    }
  }, [session]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, refreshKey]);

  if (!report || !report.persistenceReady) return null;
  const { resumen } = report;
  const sin = report.rows.filter((r) => r.status === "SIN_MATERIAL" || (r.status == null && r.accion === "ELEGIR_MATERIAL"));
  const historicas = report.rows.filter((r) => r.status === "HISTORICO");
  if (resumen.sinMaterial + resumen.historicas + resumen.pendientes === 0 && sin.length === 0) {
    return (
      <p className="mt-2 text-xs text-[var(--os-text-muted)]" data-testid="despachos-stock-resumen">
        Stock ME: {resumen.vinculadas} entrega(s) descuentan stock del inventario (una salida por entrega).
      </p>
    );
  }

  async function assign(id: string) {
    const codigo = pick[id];
    if (!codigo) return;
    setBusy(true);
    try {
      await assignDespachoMaterialApi(session, id, codigo);
      notify("Material asignado: la entrega descuenta stock.");
      await load();
      onChanged();
    } catch (e) {
      notify(e instanceof Error ? e.message : "No se pudo asignar.");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    try {
      const r = await applyHistoricoDespachosApi(session, historicas.filter((h) => h.accion === "DESCONTAR").map((h) => h.id));
      notify(`${r.aplicadas.length} entrega(s) histórica(s) descontadas del stock${r.omitidas.length ? `; ${r.omitidas.length} sin material identificado` : ""}.`);
      await load();
      onChanged();
    } catch (e) {
      notify(e instanceof Error ? e.message : "No se pudo aplicar.");
    } finally {
      setBusy(false);
    }
  }

  const descontables = historicas.filter((h) => h.accion === "DESCONTAR");
  return (
    <section className="mt-4 rounded border border-[var(--os-border)] px-3 py-3 text-sm" data-testid="despachos-stock-panel">
      <h3 className="text-sm font-semibold">Stock ME de las entregas</h3>
      <p className="mt-1 text-xs text-[var(--os-text-muted)]" data-testid="despachos-stock-resumen">
        {resumen.vinculadas} descuentan stock · {resumen.sinMaterial + resumen.pendientes} sin material identificado · {resumen.historicas} históricas sin aplicar ({fmt(resumen.unidadesHistoricas)} u.). Las entregas anteriores no tocan el stock hasta que las apliques.
      </p>
      {sin.length > 0 ? (
        <ul className="mt-2 space-y-1" data-testid="despachos-sin-material">
          {sin.slice(0, 50).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="min-w-[10rem]"><strong>{r.egreso || "—"}</strong> · {r.cliente || "—"} · {r.producto || "—"} · {fmt(r.cantidadTotal)} u. · <em>sin material identificado</em></span>
              {canEdit ? (
                <>
                  <select aria-label="Elegir material" value={pick[r.id] ?? ""} onChange={(e) => setPick((p) => ({ ...p, [r.id]: e.target.value }))} className="rounded border border-[var(--os-border)] bg-transparent px-1 py-0.5" data-testid="despachos-pick-material">
                    <option value="">Elegir material…</option>
                    {(r.candidatos.length > 1 ? report.materiales.filter((m) => r.candidatos.includes(m.codigo)) : report.materiales).map((m) => (
                      <option key={m.codigo} value={m.codigo}>{m.codigo} · {m.descripcion}{m.cliente ? ` · ${m.cliente}` : ""}</option>
                    ))}
                  </select>
                  <Button size="sm" variant="secondary" disabled={busy || !pick[r.id]} onClick={() => void assign(r.id)} data-testid="despachos-assign">Asignar y descontar</Button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canEdit && descontables.length > 0 ? (
        <div className="mt-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void apply()} data-testid="despachos-apply-historico">
            Aplicar descuento a {descontables.length} entrega(s) histórica(s)
          </Button>
        </div>
      ) : null}
    </section>
  );
}
