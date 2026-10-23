"use client";

/**
 * CONTROL SEMANAL DE MP — planilla automática (réplica del Excel «CONTROL DEPÓSITO»).
 * PRODUCTO · MATERIA PRIMA · CANT. NECESARIA · EN INVENTARIO · FALTA · ESTADO · OBSERVACIÓN · FECHA.
 * Todo sale de GENUS OS (trabajos de Elaboración, OE/fórmula y Stock MP real); solo la observación se escribe. Es una
 * herramienta de consulta: no mueve stock ni toca OE. Colores propios (fondo claro, texto oscuro): se lee igual en el tema
 * oscuro de la app y en la tablet.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import { buildTableRows, filterTableRows, fmtFecha, fmtQty, summarizeTable, TABLE_ESTADOS, type TableEstado, type TableRow } from "@/lib/mp-control/weekly-table";
import type { WeeklyAvailability } from "@/lib/mp-control/weekly-availability-service";
import { mondayOf } from "./mp-weekly-attention";

const shift = (iso: string, days: number) => {
  const x = new Date(`${iso}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + days);
  return x.toISOString().slice(0, 10);
};
const COLORS: Record<TableEstado, { bg: string; fg: string }> = {
  HAY: { bg: "#dcfce7", fg: "#166534" },
  FALTA: { bg: "#fee2e2", fg: "#991b1b" },
  "SIN DATOS": { bg: "#e5e7eb", fg: "#374151" },
};
const HEAD = ["PRODUCTO A ELABORAR", "MATERIA PRIMA", "CANT. NECESARIA", "EN INVENTARIO", "FALTA", "ESTADO", "OBSERVACIÓN", "FECHA"];
const cell: React.CSSProperties = { padding: "5px 8px", borderBottom: "1px solid #e5e7eb", fontSize: 13, lineHeight: 1.25, color: "#111827", background: "#ffffff", verticalAlign: "middle" };

export function MpWeeklyTable({ email, sector }: { email: string; sector: string }) {
  const canNote = sector === "MATERIA_PRIMA" || sector === "PRODUCCION";
  const [week, setWeek] = useState(() => mondayOf());
  const [data, setData] = useState<WeeklyAvailability | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [estado, setEstado] = useState<"TODOS" | TableEstado>("TODOS");
  const [q, setQ] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, "ok" | "err" | "saving">>({});
  const weekRef = useRef(week);
  weekRef.current = week;
  const headers = useMemo(() => ({ "Content-Type": "application/json", [ACTOR_EMAIL_HEADER]: email, [ACTOR_SECTOR_HEADER]: sector }), [email, sector]);

  const load = useCallback(async () => {
    const w = week;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/mp-control/weekly?week=${w}&_=${Date.now()}`, { credentials: "include", headers, cache: "no-store" });
      const body = (await res.json()) as WeeklyAvailability & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "No se pudo consultar");
      if (weekRef.current === w) {
        setData(body);
        setError(null);
        setDrafts({});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo consultar");
    } finally {
      setLoading(false);
    }
  }, [week, headers]);

  useEffect(() => {
    setData(null);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- consulta al abrir / al cambiar de semana
    void load();
  }, [load]);
  // Al volver a la pestaña/tablet se vuelve a consultar: el stock cambia por ingresos, salidas y consumos.
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const all = useMemo(() => (data ? buildTableRows(data) : []), [data]);
  const rows = useMemo(() => filterTableRows(all, { estado, q }), [all, estado, q]);
  const sum = useMemo(() => (data ? summarizeTable(data, all) : null), [data, all]);

  async function saveNote(r: TableRow, text: string) {
    if (!r.rowKey || !canNote) return;
    const key = r.rowKey;
    if (text === (data ? buildTableRows(data).find((x) => x.rowKey === key)?.observacion : "")) return;
    setSaved((s) => ({ ...s, [key]: "saving" }));
    try {
      const res = await fetch("/api/v1/mp-control/weekly/state", { method: "PATCH", credentials: "include", headers, body: JSON.stringify({ week, rowKey: key, label: r.materiaPrima, observacion: text }) });
      if (!res.ok) throw new Error();
      setSaved((s) => ({ ...s, [key]: "ok" }));
      setData((d) => (d ? { ...d, rows: d.rows.map((x) => (x.key === key ? { ...x, state: { ...x.state, observacion: text } } : x)) } : d));
    } catch {
      setSaved((s) => ({ ...s, [key]: "err" }));
    }
  }

  const btn = (active: boolean): React.CSSProperties => ({ minHeight: 40, padding: "0 12px", borderRadius: 6, border: "1px solid #9ca3af", fontSize: 13, fontWeight: 600, background: active ? "#1f2937" : "#ffffff", color: active ? "#ffffff" : "#111827" });

  return (
    <section data-testid="mp-weekly-table" style={{ background: "#ffffff", color: "#111827", colorScheme: "light", borderRadius: 8, padding: 10, marginBottom: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>CONTROL SEMANAL DE MATERIAS PRIMAS</h3>
        <div style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <button type="button" style={btn(false)} onClick={() => setWeek(shift(week, -7))} aria-label="Semana anterior" data-testid="mpt-prev">‹</button>
          <input type="date" value={week} onChange={(e) => e.target.value && setWeek(mondayOf(new Date(`${e.target.value}T12:00:00`)))} style={{ ...btn(false), fontWeight: 400 }} data-testid="mpt-week" />
          <button type="button" style={btn(false)} onClick={() => setWeek(shift(week, 7))} aria-label="Semana siguiente" data-testid="mpt-next">›</button>
          <button type="button" style={btn(false)} onClick={() => setWeek(mondayOf())} data-testid="mpt-today">Hoy</button>
          <button type="button" style={btn(true)} onClick={() => void load()} disabled={loading} data-testid="mpt-refresh">{loading ? "Consultando…" : "Actualizar"}</button>
        </div>
      </div>
      <p style={{ fontSize: 12, color: "#4b5563", margin: "4px 0 6px" }} data-testid="mpt-range">
        {data ? `Semana del ${fmtFecha(data.weekStart)} al ${fmtFecha(data.weekEnd)}` : "Consultando…"} · stock real de Materias Primas al {data ? new Date(data.generatedAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "—"} · solo consulta (no descuenta stock)
      </p>

      {sum ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, fontSize: 12 }} data-testid="mpt-summary">
          {[
            ["Elaboraciones programadas", sum.programadas, "#e5e7eb", "#111827", "programadas"],
            ["Con MP suficientes", sum.suficientes, COLORS.HAY.bg, COLORS.HAY.fg, "suficientes"],
            ["Con faltantes", sum.conFaltantes, COLORS.FALTA.bg, COLORS.FALTA.fg, "faltantes"],
            ["Sin datos", sum.sinDatos, COLORS["SIN DATOS"].bg, COLORS["SIN DATOS"].fg, "sindatos"],
            ["MP distintas con faltante", sum.mpConFaltante, COLORS.FALTA.bg, COLORS.FALTA.fg, "mpfalta"],
          ].map(([label, n, bg, fg, id]) => (
            <span key={String(id)} style={{ background: String(bg), color: String(fg), borderRadius: 999, padding: "3px 10px", fontWeight: 600 }} data-testid={`mpt-sum-${id}`}>
              {label}: <b>{n as number}</b>
            </span>
          ))}
        </div>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, alignItems: "center" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto o materia prima…" style={{ ...btn(false), fontWeight: 400, minWidth: 240 }} data-testid="mpt-search" />
        {TABLE_ESTADOS.map((e) => (
          <button key={e} type="button" style={btn(estado === e)} onClick={() => setEstado(e)} data-testid={`mpt-filter-${e.replace(" ", "-")}`}>{e}</button>
        ))}
      </div>

      {error ? <p role="alert" style={{ background: "#fee2e2", color: "#991b1b", padding: "6px 10px", borderRadius: 6, fontSize: 13 }} data-testid="mpt-error">No se pudo consultar: {error}. Lo que se ve puede estar desactualizado.</p> : null}

      <div style={{ overflow: "auto", maxHeight: "68vh", border: "1px solid #9ca3af", borderRadius: 6 }} data-testid="mpt-scroll">
        <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", minWidth: 1020, fontFamily: "Calibri, Arial, sans-serif" }} data-testid="mpt-table">
          <thead>
            <tr>
              {HEAD.map((h, i) => (
                <th key={h} style={{ position: "sticky", top: 0, left: i === 0 ? 0 : undefined, zIndex: i === 0 ? 4 : 3, background: "#1f2937", color: "#ffffff", fontSize: 12, fontWeight: 700, letterSpacing: 0.3, padding: "8px", textAlign: i >= 2 && i <= 4 ? "right" : i === 5 || i === 7 ? "center" : "left", whiteSpace: "nowrap", minWidth: [210, 190, 120, 125, 105, 95, 230, 95][i] }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data === null && !error ? <tr><td colSpan={8} style={{ ...cell, textAlign: "center", color: "#4b5563" }}>Consultando las elaboraciones y el stock…</td></tr> : null}
            {data !== null && rows.length === 0 ? (
              <tr><td colSpan={8} style={{ ...cell, textAlign: "center", color: "#4b5563", padding: 18 }} data-testid="mpt-empty">{all.length === 0 ? "No hay elaboraciones programadas en esta semana." : "Ningún renglón coincide con el filtro."}</td></tr>
            ) : null}
            {rows.map((r) => {
              const c = COLORS[r.estado];
              const top = r.firstOfGroup ? { borderTop: "2px solid #6b7280" } : {};
              const draft = r.rowKey ? drafts[r.rowKey] : undefined;
              return (
                <tr key={r.id} data-testid="mpt-row" data-estado={r.estado} data-first={r.firstOfGroup ? "1" : "0"}>
                  <td style={{ ...cell, ...top, position: "sticky", left: 0, zIndex: 2, fontWeight: 700, borderRight: "1px solid #d1d5db" }}>
                    {r.firstOfGroup ? (
                      <>
                        <div data-testid="mpt-producto">{r.producto}</div>
                        <div style={{ fontWeight: 400, fontSize: 11, color: "#4b5563" }} data-testid="mpt-detalle">{r.detalle}</div>
                      </>
                    ) : null}
                  </td>
                  <td style={{ ...cell, ...top }}>
                    <span data-testid="mpt-mp">{r.materiaPrima}</span>
                    {r.codigo ? <span style={{ marginLeft: 6, fontFamily: "monospace", fontSize: 11, color: "#6b7280" }}>{r.codigo}</span> : null}
                    {r.nota ? <div style={{ fontSize: 11, color: "#6b7280" }} data-testid="mpt-nota">{r.nota}</div> : null}
                  </td>
                  <td style={{ ...cell, ...top, textAlign: "right", fontVariantNumeric: "tabular-nums" }} data-testid="mpt-necesaria">{fmtQty(r.necesaria)}</td>
                  <td style={{ ...cell, ...top, textAlign: "right", fontVariantNumeric: "tabular-nums" }} data-testid="mpt-inventario">
                    {fmtQty(r.enInventario)}
                    {r.compartido && r.stockTotal != null ? <div style={{ fontSize: 10, color: "#6b7280" }}>de {fmtQty(r.stockTotal)} (compartido)</div> : null}
                  </td>
                  <td style={{ ...cell, ...top, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: r.falta ? 700 : 400, color: r.falta ? "#991b1b" : "#111827" }} data-testid="mpt-falta">{fmtQty(r.falta)}</td>
                  <td style={{ ...cell, ...top, textAlign: "center", fontWeight: 700, background: c.bg, color: c.fg }} data-testid="mpt-estado">{r.estado}</td>
                  <td style={{ ...cell, ...top }}>
                    {r.rowKey ? (
                      canNote ? (
                        <input
                          value={draft ?? r.observacion}
                          onChange={(e) => setDrafts((d) => ({ ...d, [r.rowKey!]: e.target.value }))}
                          onBlur={(e) => void saveNote(r, e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                          placeholder="Comprar, pendiente de ingreso…"
                          maxLength={500}
                          style={{ width: "100%", minHeight: 34, border: "1px solid #d1d5db", borderRadius: 4, padding: "0 6px", fontSize: 13, color: "#111827", background: "#ffffff" }}
                          data-testid="mpt-obs"
                        />
                      ) : (
                        <span>{r.observacion || "—"}</span>
                      )
                    ) : (
                      "—"
                    )}
                    {r.rowKey && saved[r.rowKey] ? <span style={{ fontSize: 10, color: saved[r.rowKey] === "err" ? "#991b1b" : "#166534" }} data-testid="mpt-obs-state">{saved[r.rowKey] === "saving" ? "Guardando…" : saved[r.rowKey] === "ok" ? "✓ guardado" : "No se pudo guardar"}</span> : null}
                  </td>
                  <td style={{ ...cell, ...top, textAlign: "center", whiteSpace: "nowrap" }} data-testid="mpt-fecha">{fmtFecha(r.fecha)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
