"use client";

/**
 * Disponibilidad REAL de MP de la semana: stock del inventario (todos los proveedores y lotes de la misma MP) contra la
 * necesidad consolidada de todas las elaboraciones programadas. Se consulta al abrir y con «Actualizar stock».
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import type { AvailabilityStatus } from "@/lib/mp-control/availability";
import type { WeeklyAvailability } from "@/lib/mp-control/weekly-availability-service";

const fmt = (n: number) => String(Number(n.toFixed(3))).replace(".", ",");
const TONE: Record<AvailabilityStatus, string> = {
  SUFICIENTE: "border-emerald-400/60 bg-emerald-400/10 text-emerald-300",
  FALTANTE: "border-amber-400/70 bg-amber-400/10 text-amber-300",
  "SIN STOCK": "border-rose-500/70 bg-rose-500/10 text-rose-300",
  "SIN DATOS CONFIABLES": "border-slate-400/60 bg-slate-400/10 text-slate-300",
};

function mondayOf(d = new Date()): string {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}
const shift = (iso: string, days: number) => {
  const x = new Date(`${iso}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + days);
  return x.toISOString().slice(0, 10);
};

export function MpWeeklyAvailability({ email, sector }: { email: string; sector: string }) {
  const [week, setWeek] = useState(mondayOf());
  const [data, setData] = useState<WeeklyAvailability | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [onlyProblems, setOnlyProblems] = useState(false);

  const headers = useMemo(() => ({ "Content-Type": "application/json", [ACTOR_EMAIL_HEADER]: email, [ACTOR_SECTOR_HEADER]: sector }), [email, sector]);

  const fetchData = useCallback(async () => {
    const res = await fetch(`/api/v1/mp-control/weekly?week=${week}&_=${Date.now()}`, { credentials: "include", headers, cache: "no-store" });
    const body = (await res.json()) as WeeklyAvailability & { error?: string };
    if (!res.ok) throw new Error(body.error ?? "No se pudo consultar el stock");
    setData(body);
    setError(null);
  }, [week, headers]);
  const showError = (e: unknown) => setError(e instanceof Error ? e.message : "Error al consultar el stock");
  const refreshClick = useCallback(async () => {
    setLoading(true);
    await fetchData().catch(showError);
    setLoading(false);
  }, [fetchData]);

  // Al abrir y al cambiar de semana. También al volver a la pestaña (el stock cambia mientras tanto).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- consulta al abrir: el estado se actualiza después de la respuesta
    void fetchData().catch((e) => setError(e instanceof Error ? e.message : "Error al consultar el stock"));
    const onVis = () => document.visibilityState === "visible" && void fetchData().catch((e) => setError(e instanceof Error ? e.message : "Error al consultar el stock"));
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [fetchData]);

  const rows = (data?.rows ?? []).filter((r) => !onlyProblems || r.estado !== "SUFICIENTE");
  const updated = data ? new Date(data.generatedAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "medium" }) : null;

  return (
    <section className="rounded border border-[var(--os-border)] p-3" data-testid="mp-weekly-availability">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <h3 className="text-sm font-semibold">Disponibilidad de MP de la semana</h3>
          <p className="text-xs text-[var(--os-text-muted)]">Stock real del inventario (todos los proveedores y lotes) contra la necesidad de TODAS las elaboraciones de la semana.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setWeek(shift(week, -7))} aria-label="Semana anterior">‹</Button>
          <input type="date" value={week} onChange={(e) => e.target.value && setWeek(e.target.value)} className="min-h-9 rounded border border-[var(--os-border)] bg-transparent px-2 text-sm" data-testid="mpw-week" />
          <Button type="button" variant="secondary" size="sm" onClick={() => setWeek(shift(week, 7))} aria-label="Semana siguiente">›</Button>
          <Button type="button" size="sm" onClick={() => void refreshClick()} disabled={loading} data-testid="mpw-refresh">{loading ? "Consultando…" : "Actualizar stock"}</Button>
        </div>
      </div>
      <p className="mt-1 text-xs text-[var(--os-text-muted)]" data-testid="mpw-updated">
        {data ? <>Semana {data.weekStart} al {data.weekEnd} · Última actualización: <b>{updated}</b> · Fuente: {data.stockSource === "inv_mp_stock" ? "Stock MP (inventario)" : "inventario en memoria"}</> : "Consultando el inventario…"}
      </p>
      {error ? <p className="mt-2 rounded border border-rose-500/60 bg-rose-500/10 px-3 py-2 text-sm" role="alert">{error}</p> : null}

      {data ? (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" data-testid="mpw-summary">
            {(Object.keys(TONE) as AvailabilityStatus[]).map((s) => (
              <span key={s} className={`rounded border px-2 py-0.5 ${TONE[s]}`}>{s}: <b>{data.summary[s]}</b></span>
            ))}
            <label className="ml-auto flex items-center gap-1"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Solo lo que requiere atención</label>
          </div>

          <details className="mt-2 text-xs" data-testid="mpw-productions">
            <summary className="cursor-pointer text-[var(--os-text-muted)]">Producciones consideradas ({data.productions.length}){data.excluded.length ? ` · ${data.excluded.length} sin datos confiables` : ""}</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {data.productions.map((p) => (
                <li key={p.id}>{p.label} · {p.days} · {p.kg != null ? `${fmt(p.kg)} kg` : "—"} · {p.source === "OE" ? `OE ${p.oeNumber}` : p.source === "FORMULA" ? "fórmula vigente (sin OE)" : "sin fórmula"}{p.note ? ` — ${p.note}` : ""}</li>
              ))}
              {data.productions.length === 0 ? <li>No hay elaboraciones programadas en esta semana.</li> : null}
            </ul>
            {data.excluded.length ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-amber-300">
                {data.excluded.map((e) => <li key={e.id}>{e.label}: {e.reason}</li>)}
              </ul>
            ) : null}
          </details>

          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[56rem] table-fixed text-xs" data-testid="mpw-table">
              <thead>
                <tr className="text-left">
                  <th className="w-[22%] p-1">Materia prima</th>
                  <th className="w-[9%] p-1">Código maestro</th>
                  <th className="w-[9%] p-1 text-right">Stock físico</th>
                  <th className="w-[9%] p-1 text-right">Utilizable</th>
                  <th className="w-[9%] p-1 text-right">Requerido semana</th>
                  <th className="w-[8%] p-1 text-right">Reservado</th>
                  <th className="w-[9%] p-1 text-right">Saldo proyectado</th>
                  <th className="w-[15%] p-1">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.key}>
                    <tr className="cursor-pointer border-t align-top hover:bg-white/5" onClick={() => setOpen((o) => ({ ...o, [r.key]: !o[r.key] }))} data-testid="mpw-row" data-estado={r.estado}>
                      <td className="whitespace-normal break-words p-1 font-medium">{open[r.key] ? "▾" : "▸"} {r.materiaPrima}</td>
                      <td className="p-1 font-mono">{r.codigoMaestro || "—"}</td>
                      <td className="p-1 text-right font-mono">{fmt(r.stockFisico)}</td>
                      <td className="p-1 text-right font-mono">{fmt(r.stockUtilizable)}</td>
                      <td className="p-1 text-right font-mono">{fmt(r.requerido)}</td>
                      <td className="p-1 text-right font-mono">{fmt(r.reservado)}</td>
                      <td className={`p-1 text-right font-mono ${r.saldoProyectado < 0 ? "text-rose-300" : ""}`}>{`${r.saldoProyectado > 0 ? "+" : ""}${fmt(r.saldoProyectado)}`}</td>
                      <td className="p-1"><span className={`inline-block rounded border px-2 py-0.5 ${TONE[r.estado]}`} data-testid="mpw-estado">{r.estado}</span>{r.faltante > 0 ? <span className="ml-1 text-rose-300">falta {fmt(r.faltante)} kg</span> : null}</td>
                    </tr>
                    {open[r.key] ? (
                      <tr className="bg-black/10" data-testid="mpw-detail">
                        <td colSpan={8} className="p-2">
                          <div className="space-y-2">
                              <p className="text-[var(--os-text-muted)]">Stock MP sumado (columna Descripción): {r.stockNames.join(" · ") || "ninguna fila coincide con este nombre"}</p>
                              <table className="w-full table-fixed text-xs" data-testid="mpw-lots">
                                <thead><tr className="text-left"><th className="p-1">Descripción</th><th className="p-1">Proveedor</th><th className="p-1">Lote</th><th className="p-1">Vence</th><th className="p-1 text-right">Kg</th><th className="p-1">Utilizable</th></tr></thead>
                                <tbody>
                                  {r.lotes.map((l, i) => (
                                    <tr key={i} className="border-t">
                                      <td className="whitespace-normal break-words p-1">{l.descripcion}</td>
                                      <td className="whitespace-normal break-words p-1">{l.proveedor}</td>
                                      <td className="p-1">{l.lote}</td>
                                      <td className="p-1">{l.vencimiento || "—"}</td>
                                      <td className="p-1 text-right font-mono">{fmt(l.kg)}</td>
                                      <td className="p-1">{l.usable ? "Sí" : `No — ${l.motivo}`}</td>
                                    </tr>
                                  ))}
                                  {r.lotes.length === 0 ? <tr><td colSpan={6} className="p-1">Sin existencias en el Stock MP con este nombre.</td></tr> : null}
                                </tbody>
                              </table>
                              <p>Por proveedor: {r.proveedores.map((p) => `${p.proveedor}: ${fmt(p.kgUtilizable)} kg`).join(" · ") || "—"}</p>
                              <p>Necesidad por producción: {r.needs.map((n) => `${n.label}: ${fmt(n.kg)} kg`).join(" · ") || "—"}</p>
                              {r.notas.map((n, i) => <p key={i} className="text-amber-200">{n}</p>)}
                            </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
                {rows.length === 0 ? <tr><td colSpan={8} className="p-3 text-center text-[var(--os-text-muted)]">{data.rows.length === 0 ? "No hay necesidades de MP para esta semana." : "Todo está cubierto."}</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
