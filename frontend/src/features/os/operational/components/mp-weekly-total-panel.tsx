"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import { fmtKg } from "@/lib/mp-control/availability-tone";
import type { WeeklyTotalData } from "@/lib/mp-control/weekly-availability-service";
import { mondayOf } from "./mp-weekly-attention";

const shift = (iso: string, days: number) => {
  const x = new Date(`${iso}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + days);
  return x.toISOString().slice(0, 10);
};
const fmtDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const REFRESH_MS = 30_000;

type SortKey = "faltante" | "necesario" | "nombre";

/**
 * CONTROL SEMANAL TOTAL: kg necesarios de cada materia prima para TODAS las OE de Elaboración de la semana (o las SIN FECHA),
 * consolidados por materia prima de inventario, contra el stock real. Vista de planificación: no genera movimientos de stock.
 */
export function MpWeeklyTotalPanel() {
  const { email, sectorId } = usePreviewSession();
  const headers = useMemo<HeadersInit>(() => ({ [ACTOR_EMAIL_HEADER]: email ?? "", [ACTOR_SECTOR_HEADER]: sectorId }), [email, sectorId]);
  const [week, setWeek] = useState(() => mondayOf());
  const [sinFecha, setSinFecha] = useState(false);
  const [data, setData] = useState<WeeklyTotalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [soloFaltantes, setSoloFaltantes] = useState(false);
  const [sort, setSort] = useState<SortKey>("faltante");
  const [open, setOpen] = useState<string | null>(null);

  const param = sinFecha ? "sin-fecha" : week;
  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await fetch(`/api/v1/mp-control/weekly-total?week=${encodeURIComponent(param)}`, { credentials: "include", headers, cache: "no-store" });
        const body = (await res.json()) as WeeklyTotalData & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "No se pudo calcular el control semanal total.");
        setData(body);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [param, headers]
  );

  // Actualización automática: al abrir/cambiar de semana, cada 30 s y al volver a la pestaña (OE, fórmulas y planificación cambian).
  useEffect(() => {
    const t0 = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(true), REFRESH_MS);
    const onVis = () => document.visibilityState === "visible" && void load(true);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = (data?.rows ?? []).filter((r) => (!soloFaltantes || r.faltante > 0) && (!term || `${r.codigo} ${r.materiaPrima}`.toLowerCase().includes(term)));
    return [...list].sort((a, b) =>
      sort === "nombre" ? a.materiaPrima.localeCompare(b.materiaPrima, "es") : sort === "necesario" ? b.necesario - a.necesario || b.faltante - a.faltante : b.faltante - a.faltante || b.necesario - a.necesario
    );
  }, [data, q, soloFaltantes, sort]);

  async function exportExcel() {
    const res = await fetch(`/api/v1/mp-control/weekly-total?week=${encodeURIComponent(param)}&format=xlsx`, { credentials: "include", headers });
    if (!res.ok) {
      setError("No se pudo exportar a Excel.");
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `control-semanal-total-${sinFecha ? "sin-fecha" : (data?.weekStart ?? week)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="space-y-3" data-testid="mp-total">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" disabled={sinFecha} onClick={() => setWeek((w) => shift(w, -7))} data-testid="mp-total-prev">‹ Semana anterior</Button>
        <input type="date" aria-label="Semana" className="rounded border px-2 py-1.5 text-sm" value={week} disabled={sinFecha} onChange={(e) => e.target.value && setWeek(mondayOf(new Date(`${e.target.value}T12:00:00`)))} data-testid="mp-total-week" />
        <Button type="button" variant="secondary" disabled={sinFecha} onClick={() => setWeek((w) => shift(w, 7))} data-testid="mp-total-next">Semana siguiente ›</Button>
        <Button type="button" variant="secondary" disabled={sinFecha} onClick={() => setWeek(mondayOf())}>Hoy</Button>
        <label className="inline-flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={sinFecha} onChange={(e) => setSinFecha(e.target.checked)} data-testid="mp-total-sin-fecha" /> Sin fecha
        </label>
        <input className="min-w-[14rem] rounded border px-3 py-1.5 text-sm" placeholder="Buscar materia prima o código…" aria-label="Buscar materia prima" value={q} onChange={(e) => setQ(e.target.value)} data-testid="mp-total-search" />
        <label className="inline-flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={soloFaltantes} onChange={(e) => setSoloFaltantes(e.target.checked)} data-testid="mp-total-solo-faltantes" /> Solo faltantes
        </label>
        <select className="rounded border px-2 py-1.5 text-sm" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Ordenar" data-testid="mp-total-sort">
          <option value="faltante">Mayor faltante</option>
          <option value="necesario">Mayor cantidad necesaria</option>
          <option value="nombre">Materia prima A-Z</option>
        </select>
        <Button type="button" variant="secondary" onClick={() => void exportExcel()} data-testid="mp-total-export">Exportar a Excel</Button>
      </div>

      <p className="text-xs text-[var(--os-text-muted)]">
        {sinFecha ? "OE y trabajos de Elaboración SIN fecha asignada (no se ubican en ninguna semana)." : data?.weekStart ? `Semana ${fmtDay(data.weekStart)} – ${fmtDay(data.weekEnd!)} (fechas de planificación de Elaboración).` : "Calculando…"}{" "}
        Necesario = necesidad pendiente (teórica − consumo ya registrado). Vista de planificación: no mueve stock.
        {data ? ` Actualizado ${new Date(data.generatedAt).toLocaleTimeString("es-AR")}.` : ""}
      </p>
      {error ? <p className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900" role="alert">{error}</p> : null}
      {loading && !data ? <p className="text-sm text-[var(--os-text-muted)]">Calculando…</p> : null}

      {data ? (
        <>
          <div className="flex flex-wrap gap-3 text-sm" data-testid="mp-total-resumen">
            <span><strong>{data.summary.total}</strong> materias primas</span>
            <span><strong>{data.summary.oeCount}</strong> OE</span>
            <span>Necesario <strong>{fmtKg(data.summary.necesarioKg)}</strong></span>
            <span className={data.summary.conFaltante ? "font-semibold text-rose-700" : ""}>{data.summary.conFaltante} con faltante · {fmtKg(data.summary.faltanteKg)}</span>
            {data.summary.sinIdentificar ? <span className="text-amber-800">{data.summary.sinIdentificar} sin identificar en inventario</span> : null}
          </div>
          {data.incompletas.length ? (
            <p className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900" role="status">
              {data.incompletas.length} producción(es) sin cantidad/fórmula confiable no se suman: {data.incompletas.slice(0, 4).map((i) => `${i.label} (${i.reason})`).join(" · ")}
            </p>
          ) : null}
          {data.omitted.length ? (
            <details className="text-xs text-[var(--os-text-muted)]">
              <summary>{data.omitted.length} trabajo(s) que no suman (cancelados, finalizados o repetidos)</summary>
              <ul className="mt-1 list-disc pl-5">{data.omitted.map((o) => <li key={o.id}>{o.label}{o.oeNumber ? ` · ${o.oeNumber}` : ""}: {o.note}</li>)}</ul>
            </details>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="text-xs text-[var(--os-text-muted)]">
                <tr>
                  <th className="p-2">Código</th>
                  <th className="p-2">Materia prima</th>
                  <th className="p-2 text-right" title="% × kg del lote de cada OE">Teórica</th>
                  <th className="p-2 text-right" title="Ya descontado del inventario por las OE (libro mayor)">Consumo registrado</th>
                  <th className="p-2 text-right">Total necesario</th>
                  <th className="p-2 text-right">Stock disponible</th>
                  <th className="p-2 text-right">Faltante</th>
                  <th className="p-2 text-right">OE</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={8} className="p-3 text-[var(--os-text-muted)]">{sinFecha ? "No hay OE de Elaboración sin fecha." : "No hay materias primas para esta semana."}</td></tr>
                ) : null}
                {rows.map((r) => (
                  <Fragment key={r.key}>
                    <tr className={`cursor-pointer border-t ${r.faltante > 0 ? "bg-rose-500/10" : ""}`} onClick={() => setOpen(open === r.key ? null : r.key)} data-testid="mp-total-row" data-faltante={r.faltante > 0 ? "1" : "0"} aria-expanded={open === r.key}>
                      <td className="p-2 font-mono text-xs">{r.codigo || "—"}</td>
                      <td className="p-2 font-medium">{open === r.key ? "▾ " : "▸ "}{r.materiaPrima}{r.identificada ? "" : <span className="ml-2 rounded bg-amber-100 px-1.5 text-[11px] text-amber-900">{r.estado === "MP AMBIGUA" ? "ambigua" : "sin identificar"}</span>}</td>
                      <td className="p-2 text-right tabular-nums text-[var(--os-text-muted)]">{fmtKg(r.teorico)}</td>
                      <td className="p-2 text-right tabular-nums text-[var(--os-text-muted)]">{fmtKg(r.consumido)}</td>
                      <td className="p-2 text-right font-semibold tabular-nums" data-testid="mp-total-necesario">{fmtKg(r.necesario)}</td>
                      <td className="p-2 text-right tabular-nums" title={r.stockFisico !== r.stockDisponible ? `Físico ${fmtKg(r.stockFisico)} (parte bloqueada, vencida o reservada)` : undefined}>{fmtKg(r.stockDisponible)}</td>
                      <td className={`p-2 text-right font-semibold tabular-nums ${r.faltante > 0 ? "text-rose-700" : ""}`} data-testid="mp-total-faltante">{fmtKg(r.faltante)}</td>
                      <td className="p-2 text-right tabular-nums">{r.oeCount}</td>
                    </tr>
                    {open === r.key ? (
                      <tr className="bg-[var(--os-surface)]">
                        <td colSpan={8} className="p-2">
                          {r.notas.length ? <p className="mb-1 text-xs text-amber-800">{r.notas.join(" ")}</p> : null}
                          <table className="w-full text-xs" data-testid="mp-total-detalle">
                            <thead className="text-[var(--os-text-muted)]">
                              <tr><th className="p-1 text-left">OE</th><th className="p-1 text-left">Cliente</th><th className="p-1 text-left">Producto</th><th className="p-1 text-left">Fecha</th><th className="p-1 text-right">Lote (kg)</th><th className="p-1 text-right">Teórico</th><th className="p-1 text-right">Consumido</th><th className="p-1 text-right">Kg necesarios</th></tr>
                            </thead>
                            <tbody>
                              {r.needs.map((n, i) => (
                                <tr key={`${n.productionId}-${i}`} className="border-t">
                                  <td className="p-1">{n.oeNumber || "(sin OE: fórmula)"}</td><td className="p-1">{n.client}</td><td className="p-1">{n.product}</td><td className="p-1">{n.days}</td>
                                  <td className="p-1 text-right tabular-nums">{n.lotKg != null ? fmtKg(n.lotKg) : "—"}</td>
                                  <td className="p-1 text-right tabular-nums">{n.incompleta ? "sin dato" : fmtKg(n.teorico)}</td>
                                  <td className="p-1 text-right tabular-nums">{fmtKg(n.consumido)}</td>
                                  <td className="p-1 text-right font-medium tabular-nums">{fmtKg(n.pendiente)}</td>
                                </tr>
                              ))}
                              <tr className="border-t font-semibold"><td className="p-1" colSpan={5}>TOTAL consolidado</td><td className="p-1 text-right tabular-nums">{fmtKg(r.teorico)}</td><td className="p-1 text-right tabular-nums">{fmtKg(r.consumido)}</td><td className="p-1 text-right tabular-nums">{fmtKg(r.necesario)}</td></tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
