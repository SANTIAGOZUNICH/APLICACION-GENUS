"use client";

/**
 * Disponibilidad REAL de MP de la semana: stock del inventario (Stock MP → DESCRIPCIÓN / KG LOTE, todas las filas de la
 * misma MP) contra la necesidad consolidada de todas las elaboraciones programadas. Se consulta al abrir y con
 * «Actualizar stock». Un error de consulta se muestra como error: nunca como stock cero.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import type { AvailabilityStatus } from "@/lib/mp-control/availability";
import type { WeeklyAvailability, WeeklyRow } from "@/lib/mp-control/weekly-availability-service";

const fmt = (n: number) => String(Number(n.toFixed(3))).replace(".", ",");
const TONE: Record<AvailabilityStatus, string> = {
  SUFICIENTE: "border-emerald-400/60 bg-emerald-400/10 text-emerald-300",
  FALTANTE: "border-amber-400/70 bg-amber-400/10 text-amber-300",
  "SIN STOCK": "border-rose-500/70 bg-rose-500/10 text-rose-300",
  "SIN STOCK UTILIZABLE": "border-rose-500/70 bg-rose-500/10 text-rose-300",
  "MP NO IDENTIFICADA": "border-sky-400/60 bg-sky-400/10 text-sky-300",
  "DATOS INCOMPLETOS": "border-slate-400/60 bg-slate-400/10 text-slate-300",
};

const GESTION_LABEL: Record<string, string> = {
  "": "— Sin decisión —",
  pendiente: "Pendiente",
  comprar: "Comprar",
  compra_solicitada: "Compra solicitada",
  no_comprar: "No comprar",
  sustituir: "Sustituir",
  aporta_cliente: "Aporta el cliente",
  resuelto: "Resuelto",
};
const fmtWhen = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "");

/** Observación general por MP y semana: se guarda al salir del campo o con «Guardar»; crece según el texto. */
function NoteCell({ row, canEdit, onSave }: { row: WeeklyRow; canEdit: boolean; onSave: (row: WeeklyRow, text: string) => Promise<void> }) {
  const saved = row.state.observacion;
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const value = draft ?? saved;
  const dirty = draft !== null && draft !== saved;
  async function commit() {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await onSave(row, draft!);
      setDraft(null);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div onClick={(e) => e.stopPropagation()} data-testid="mpw-note">
      {canEdit ? (
        <>
          <textarea
            value={value}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            rows={Math.min(8, Math.max(2, Math.ceil(value.length / 28) + (value.match(/\n/g)?.length ?? 0)))}
            placeholder="Observación (compras, sustitución…)"
            className="w-full resize-y rounded border border-[var(--os-border)] bg-transparent px-1.5 py-1 text-xs leading-snug"
            data-testid="mpw-note-input"
          />
          {dirty ? (
            <button type="button" className="mt-1 rounded border border-[var(--os-teal)] px-2 py-1 text-[11px] text-[var(--os-teal)]" onMouseDown={(e) => e.preventDefault()} onClick={() => void commit()} data-testid="mpw-note-save">
              {saving ? "Guardando…" : "Guardar"}
            </button>
          ) : null}
        </>
      ) : (
        <p className="whitespace-pre-wrap break-words text-xs">{saved || "—"}</p>
      )}
      {saved && row.state.observacionBy ? <p className="mt-0.5 text-[10px] text-[var(--os-text-muted)]" data-testid="mpw-note-meta">{row.state.observacionBy} · {fmtWhen(row.state.observacionAt)}</p> : null}
    </div>
  );
}

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
  const canEdit = sector === "MATERIA_PRIMA";
  const [week, setWeek] = useState(mondayOf());
  const [data, setData] = useState<WeeklyAvailability | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [including, setIncluding] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const headers = useMemo(() => ({ "Content-Type": "application/json", [ACTOR_EMAIL_HEADER]: email, [ACTOR_SECTOR_HEADER]: sector }), [email, sector]);

  const fetchData = useCallback(async () => {
    const res = await fetch(`/api/v1/mp-control/weekly?week=${week}&_=${Date.now()}`, { credentials: "include", headers, cache: "no-store" });
    const body = (await res.json()) as WeeklyAvailability & { error?: string };
    if (!res.ok) throw new Error(body.error ?? "No se pudo consultar el stock");
    setData(body);
    setError(null);
  }, [week, headers]);
  const refreshClick = useCallback(async () => {
    setLoading(true);
    await fetchData().catch((e) => setError(e instanceof Error ? e.message : "No se pudo consultar el stock"));
    setLoading(false);
  }, [fetchData]);

  // Al abrir y al cambiar de semana. También al volver a la pestaña (el stock cambia mientras tanto).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- consulta al abrir: el estado se actualiza después de la respuesta
    void fetchData().catch((e) => setError(e instanceof Error ? e.message : "No se pudo consultar el stock"));
    const onVis = () => document.visibilityState === "visible" && void fetchData().catch((e) => setError(e instanceof Error ? e.message : "No se pudo consultar el stock"));
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [fetchData]);

  async function include(formulaName: string, stockName: string) {
    setIncluding(`${formulaName}|${stockName}`);
    try {
      const res = await fetch("/api/v1/mp-control/aliases", { method: "POST", credentials: "include", headers, body: JSON.stringify({ formulaName, stockName }) });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "No se pudo guardar la equivalencia");
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la equivalencia");
    } finally {
      setIncluding(null);
    }
  }

  async function post(url: string, body: unknown, method = "POST") {
    const res = await fetch(url, { method, credentials: "include", headers, body: JSON.stringify(body) });
    const out = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(out.error ?? "No se pudo guardar");
    return out;
  }
  async function saveNote(row: WeeklyRow, observacion: string) {
    try {
      await post("/api/v1/mp-control/weekly/state", { week: data!.weekStart, rowKey: row.key, label: row.materiaPrima, observacion }, "PATCH");
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la observación");
      throw e;
    }
  }
  async function saveGestion(row: WeeklyRow, gestion: string) {
    try {
      await post("/api/v1/mp-control/weekly/state", { week: data!.weekStart, rowKey: row.key, label: row.materiaPrima, gestion }, "PATCH");
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la decisión");
    }
  }
  async function removeRows(keys: string[]) {
    setBusy(true);
    try {
      const out = (await post("/api/v1/mp-control/weekly/exclude", { week: data!.weekStart, rowKeys: keys })) as { excluded?: number };
      setNotice(`Se quitaron ${out.excluded ?? keys.length} materia${(out.excluded ?? keys.length) === 1 ? "" : "s"} prima${(out.excluded ?? keys.length) === 1 ? "" : "s"} del control de esta semana. El inventario, las fórmulas y las OE no se tocaron.`);
      setSelected(new Set());
      setConfirmDelete(null);
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron quitar");
    } finally {
      setBusy(false);
    }
  }
  async function restoreRowsClick(keys: string[]) {
    try {
      await post("/api/v1/mp-control/weekly/exclude", { week: data!.weekStart, rowKeys: keys, restore: true });
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo restaurar");
    }
  }
  async function productionAction(id: string, label: string, restore: boolean) {
    try {
      await post("/api/v1/mp-control/weekly/exclude-production", { week: data!.weekStart, items: [{ workItemId: id, label }], restore, reason: "Quitada manualmente del Control semanal" });
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar la producción");
    }
  }

  const rows = (data?.rows ?? []).filter((r) => !onlyProblems || r.estado !== "SUFICIENTE");
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.key));
  const toggle = (key: string) => setSelected((cur) => { const n = new Set(cur); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const updated = data ? new Date(data.generatedAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "medium" }) : null;

  return (
    <section className="rounded border border-[var(--os-border)] p-3" data-testid="mp-weekly-availability">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <h3 className="text-sm font-semibold">Disponibilidad de MP de la semana</h3>
          <p className="text-xs text-[var(--os-text-muted)]">Stock actual del Stock MP (Descripción y Kg lote de todas las filas de la misma MP) contra la necesidad de TODAS las elaboraciones de la semana.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setWeek(shift(week, -7))} aria-label="Semana anterior">‹</Button>
          <input type="date" value={week} onChange={(e) => e.target.value && setWeek(e.target.value)} className="min-h-9 rounded border border-[var(--os-border)] bg-transparent px-2 text-sm" data-testid="mpw-week" />
          <Button type="button" variant="secondary" size="sm" onClick={() => setWeek(shift(week, 7))} aria-label="Semana siguiente">›</Button>
          <Button type="button" size="sm" onClick={() => void refreshClick()} disabled={loading} data-testid="mpw-refresh">{loading ? "Consultando…" : "Actualizar stock"}</Button>
        </div>
      </div>
      <p className="mt-1 text-xs text-[var(--os-text-muted)]" data-testid="mpw-updated">
        {data ? (
          <>
            Semana {data.weekStart} al {data.weekEnd} · Última actualización: <b>{updated}</b> · Fuente: {data.stockSource === "inv_mp_stock" ? "Stock MP (inventario)" : "inventario en memoria"} · Filas de stock leídas: <b data-testid="mpw-rows-read">{data.stockRowsRead}</b> ({data.stockRowsActive} activas) · Versión {(process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "dev").slice(0, 7)}
          </>
        ) : (
          "Consultando el inventario…"
        )}
      </p>
      {notice ? <p className="mt-2 rounded border border-emerald-400/60 bg-emerald-400/10 px-3 py-2 text-xs" role="status" data-testid="mpw-notice">{notice}</p> : null}
      {error ? <p className="mt-2 rounded border border-rose-500/60 bg-rose-500/10 px-3 py-2 text-sm" role="alert" data-testid="mpw-error">No se pudo consultar el stock real: {error}. Los valores que se ven pueden estar desactualizados.</p> : null}

      {data ? (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" data-testid="mpw-summary">
            {(Object.keys(TONE) as AvailabilityStatus[]).map((s) => (data.summary[s] > 0 || s === "SUFICIENTE" || s === "FALTANTE") ? (
              <span key={s} className={`rounded border px-2 py-0.5 ${TONE[s]}`}>{s}: <b>{data.summary[s]}</b></span>
            ) : null)}
            <label className="ml-auto flex items-center gap-1"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Solo lo que requiere atención</label>
          </div>

          {canEdit ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" data-testid="mpw-select-bar">
              <Button type="button" size="sm" className="min-h-11" variant={selectMode ? "primary" : "secondary"} onClick={() => { setSelectMode((m) => !m); setSelected(new Set()); setConfirmDelete(null); }} data-testid="mpw-select-toggle">{selectMode ? "Salir de selección" : "Seleccionar"}</Button>
              {selectMode ? (
                <>
                  <Button type="button" size="sm" className="min-h-11" variant="secondary" onClick={() => setSelected(new Set(rows.map((r) => r.key)))} data-testid="mpw-select-all">Seleccionar todos</Button>
                  <Button type="button" size="sm" className="min-h-11" variant="secondary" onClick={() => setSelected(new Set())} data-testid="mpw-select-none">Deseleccionar todos</Button>
                  <span className="rounded border border-[var(--os-border)] px-2 py-1" data-testid="mpw-selected-count">{selected.size} seleccionada{selected.size === 1 ? "" : "s"}</span>
                  <Button type="button" size="sm" className="min-h-11" variant="destructive" disabled={selected.size === 0 || busy} onClick={() => setConfirmDelete([...selected])} data-testid="mpw-delete-selected">Eliminar seleccionados ({selected.size})</Button>
                </>
              ) : null}
            </div>
          ) : null}
          {confirmDelete ? (
            <div className="mt-2 rounded border border-rose-500/60 bg-rose-500/10 p-3 text-sm" role="alertdialog" data-testid="mpw-confirm-delete">
              <p>Vas a quitar <b>{confirmDelete.length}</b> materia{confirmDelete.length === 1 ? "" : "s"} prima{confirmDelete.length === 1 ? "" : "s"} del Control semanal de esta semana (queda registrado quién y cuándo).</p>
              <p className="mt-1 text-xs text-[var(--os-text-muted)]">No se elimina nada del inventario, no cambia el stock, ni las fórmulas, ni las OE, ni los consumos. Si después aparecen necesidades nuevas de esa materia prima, vuelve a mostrarse con un aviso. Se puede restaurar.</p>
              <div className="mt-2 flex gap-2">
                <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => void removeRows(confirmDelete)} data-testid="mpw-confirm-delete-yes">{busy ? "Quitando…" : "Quitar del control"}</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setConfirmDelete(null)} data-testid="mpw-confirm-delete-no">Cancelar</Button>
              </div>
            </div>
          ) : null}

          <details className="mt-2 text-xs" data-testid="mpw-productions">
            <summary className="cursor-pointer text-[var(--os-text-muted)]">Producciones consideradas ({data.productions.length}){data.excluded.length ? ` · ${data.excluded.length} con datos incompletos` : ""}</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {data.productions.map((p) => (
                <li key={p.id}>{p.label} · {p.days} · {p.kg != null ? `${fmt(p.kg)} kg` : "—"} · {p.source === "OE" ? `OE ${p.oeNumber}` : p.source === "FORMULA" ? "fórmula vigente (sin OE)" : "sin fórmula"}{p.note ? ` — ${p.note}` : ""}{canEdit ? <button type="button" className="ml-2 rounded border border-rose-500/50 px-1.5 py-0.5 text-[11px] text-rose-300" onClick={() => void productionAction(p.id, p.label, false)} data-testid="mpw-prod-remove">Quitar del cálculo</button> : null}</li>
              ))}
              {data.productions.length === 0 ? <li>No hay elaboraciones programadas en esta semana.</li> : null}
            </ul>
            {data.excludedProductions.length ? (
              <div className="mt-1" data-testid="mpw-prod-excluded">
                <p className="text-[var(--os-text-muted)]">Producciones quitadas del cálculo de esta semana:</p>
                <ul className="list-disc space-y-0.5 pl-5">
                  {data.excludedProductions.map((p) => (
                    <li key={p.workItemId}>{p.label} · {p.by} · {fmtWhen(p.at)}{p.reason ? ` — ${p.reason}` : ""}{canEdit ? <button type="button" className="ml-2 rounded border border-[var(--os-border)] px-1.5 py-0.5 text-[11px]" onClick={() => void productionAction(p.workItemId, p.label, true)} data-testid="mpw-prod-restore">Volver a sumar</button> : null}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {data.excluded.length ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-amber-300">
                {data.excluded.map((e) => <li key={e.id}>{e.label}: {e.reason}</li>)}
              </ul>
            ) : null}
          </details>

          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[78rem] table-fixed text-xs" data-testid="mpw-table">
              <thead>
                <tr className="text-left">
                  {selectMode ? (
                    <th className="w-[44px] p-1"><input type="checkbox" aria-label="Seleccionar todos" className="size-5" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.key)) : new Set())} data-testid="mpw-check-all" /></th>
                  ) : null}
                  <th className="w-[15%] p-1">Materia prima</th>
                  <th className="w-[7%] p-1">Código</th>
                  <th className="w-[6%] p-1 text-right">Stock físico</th>
                  <th className="w-[6%] p-1 text-right">Utilizable</th>
                  <th className="w-[6%] p-1 text-right">Necesidad semana</th>
                  <th className="w-[6%] p-1 text-right">Reservado</th>
                  <th className="w-[6%] p-1 text-right">Saldo proyectado</th>
                  <th className="w-[11%] p-1">Estado</th>
                  <th className="w-[10%] p-1">Gestión / decisión</th>
                  <th className="w-[17%] p-1">Observaciones</th>
                  {canEdit && !selectMode ? <th className="w-[7%] p-1">Acción</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.key}>
                    <tr className={`cursor-pointer border-t align-top hover:bg-white/5 ${selected.has(r.key) ? "bg-[var(--os-teal)]/15 outline outline-1 outline-[var(--os-teal)]" : ""}`} onClick={() => (selectMode ? toggle(r.key) : setOpen((o) => ({ ...o, [r.key]: !o[r.key] })))} data-testid="mpw-row" data-estado={r.estado} data-selected={selected.has(r.key) ? "true" : "false"}>
                      {selectMode ? (
                        <td className="p-1" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Seleccionar ${r.materiaPrima}`} className="size-6" checked={selected.has(r.key)} onChange={() => toggle(r.key)} data-testid="mpw-check" /></td>
                      ) : null}
                      <td className="whitespace-normal break-words p-1 font-medium">{open[r.key] ? "▾" : "▸"} {r.materiaPrima}</td>
                      <td className="whitespace-normal break-words p-1 font-mono">{r.codigoMaestro || "—"}</td>
                      <td className="p-1 text-right font-mono">{fmt(r.stockFisico)}</td>
                      <td className="p-1 text-right font-mono">{fmt(r.stockUtilizable)}</td>
                      <td className="p-1 text-right font-mono">{fmt(r.requerido)}</td>
                      <td className="p-1 text-right font-mono">{fmt(r.reservado)}</td>
                      <td className={`p-1 text-right font-mono ${r.saldoProyectado < 0 ? "text-rose-300" : ""}`}>{`${r.saldoProyectado > 0 ? "+" : ""}${fmt(r.saldoProyectado)}`}</td>
                      <td className="p-1"><span className={`inline-block rounded border px-2 py-0.5 ${TONE[r.estado]}`} data-testid="mpw-estado">{r.estado}</span>{r.faltante > 0 ? <span className="ml-1 text-rose-300">falta {fmt(r.faltante)} kg</span> : null}{r.related.length > 0 ? <span className="ml-1 text-sky-300" title="Hay descripciones parecidas en el Stock sin sumar">· {r.related.length} parecida{r.related.length > 1 ? "s" : ""}</span> : null}{r.state.exclusionToReview ? <span className="mt-1 block text-amber-300" data-testid="mpw-review">Se había quitado, pero aparecieron necesidades nuevas: revisar.</span> : null}</td>
                      <td className="p-1" onClick={(e) => e.stopPropagation()}>
                        {canEdit ? (
                          <select value={r.state.gestion} onChange={(e) => void saveGestion(r, e.target.value)} className="w-full min-h-9 rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-1 text-xs" data-testid="mpw-gestion">
                            {Object.entries(GESTION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                          </select>
                        ) : (
                          <span>{GESTION_LABEL[r.state.gestion] ?? "—"}</span>
                        )}
                        {r.state.gestion && r.state.gestionBy ? <p className="mt-0.5 text-[10px] text-[var(--os-text-muted)]">{r.state.gestionBy} · {fmtWhen(r.state.gestionAt)}</p> : null}
                      </td>
                      <td className="p-1"><NoteCell row={r} canEdit={canEdit} onSave={saveNote} /></td>
                      {canEdit && !selectMode ? (
                        <td className="p-1" onClick={(e) => e.stopPropagation()}>
                          <button type="button" className="min-h-9 rounded border border-rose-500/50 px-2 text-[11px] text-rose-300" onClick={() => setConfirmDelete([r.key])} data-testid="mpw-row-remove">Quitar</button>
                        </td>
                      ) : null}
                    </tr>
                    {open[r.key] ? (
                      <tr className="bg-black/10" data-testid="mpw-detail">
                        <td colSpan={12} className="p-2">
                          <div className="space-y-2">
                            <p className="text-[var(--os-text-muted)]">Stock MP sumado (columna Descripción): {r.stockNames.join(" · ") || "ninguna fila del Stock tiene exactamente este nombre"}</p>
                            {r.lotes.length > 0 ? (
                              <table className="w-full table-fixed text-xs" data-testid="mpw-lots">
                                <thead><tr className="text-left"><th className="p-1">Descripción</th><th className="p-1">Código</th><th className="p-1">Proveedor</th><th className="p-1">Cliente</th><th className="p-1">Lote</th><th className="p-1">Ubicación</th><th className="p-1">Vence</th><th className="p-1 text-right">Kg lote</th><th className="p-1">Utilizable</th></tr></thead>
                                <tbody>
                                  {r.lotes.map((l, i) => (
                                    <tr key={i} className="border-t">
                                      <td className="whitespace-normal break-words p-1">{l.descripcion}{l.fuente === "equivalencia aprobada" ? " (equivalencia aprobada)" : ""}</td>
                                      <td className="whitespace-normal break-words p-1 font-mono">{l.codigo || "—"}</td>
                                      <td className="whitespace-normal break-words p-1">{l.proveedor}</td>
                                      <td className="whitespace-normal break-words p-1">{l.cliente || "—"}</td>
                                      <td className="whitespace-normal break-words p-1">{l.lote}</td>
                                      <td className="whitespace-normal break-words p-1">{l.ubicacion || "—"}</td>
                                      <td className="p-1">{l.vencimiento || "—"}</td>
                                      <td className="p-1 text-right font-mono">{fmt(l.kgRegistrados)}</td>
                                      <td className="p-1">{l.usable ? "Sí" : `No — ${l.motivo}`}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : null}
                            {r.proveedores.length ? <p>Por proveedor: {r.proveedores.map((p) => `${p.proveedor}: ${fmt(p.kgUtilizable)} kg utilizables`).join(" · ")}</p> : null}
                            <p>Necesidad por producción: {r.needs.map((n) => `${n.label}: ${fmt(n.kg)} kg`).join(" · ") || "—"}</p>
                            {r.estado === "MP NO IDENTIFICADA" ? <p className="text-sky-200">Ninguna fila del Stock MP tiene este nombre. No se asume stock cero: elegí abajo si alguna descripción parecida es la misma materia prima.</p> : null}
                            {r.related.length > 0 ? (
                              <div className="rounded border border-sky-400/40 p-2" data-testid="mpw-related">
                                <p className="mb-1 text-sky-200">Descripciones parecidas en el Stock (NO sumadas todavía):</p>
                                <ul className="space-y-1">
                                  {r.related.map((x) => (
                                    <li key={x.stockName} className="flex flex-wrap items-center gap-2">
                                      <span>{x.descripcion} — {fmt(x.kg)} kg en {x.filas} fila{x.filas > 1 ? "s" : ""}</span>
                                      {sector === "MATERIA_PRIMA" ? (
                                        <Button type="button" size="sm" variant="secondary" disabled={including === `${r.formulaNames[0]}|${x.stockName}`} onClick={() => void include(r.formulaNames[0]!, x.stockName)} data-testid="mpw-include">
                                          {including === `${r.formulaNames[0]}|${x.stockName}` ? "Guardando…" : "Es la misma MP: sumar"}
                                        </Button>
                                      ) : null}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                            {r.notas.map((n, i) => <p key={i} className="text-amber-200">{n}</p>)}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
                {rows.length === 0 ? <tr><td colSpan={12} className="p-3 text-center text-[var(--os-text-muted)]">{data.rows.length === 0 ? "No hay necesidades de MP para esta semana." : "Todo está cubierto."}</td></tr> : null}
              </tbody>
            </table>
          </div>
          {data.excludedRows.length > 0 ? (
            <details className="mt-2 text-xs" data-testid="mpw-excluded">
              <summary className="cursor-pointer text-[var(--os-text-muted)]">Materias primas quitadas de esta semana ({data.excludedRows.length})</summary>
              <ul className="mt-1 space-y-1">
                {data.excludedRows.map((r) => (
                  <li key={r.key} className="flex flex-wrap items-center gap-2">
                    <span>{r.materiaPrima} — la quitó {r.state.excludedBy} el {fmtWhen(r.state.excludedAt)}</span>
                    {canEdit ? <button type="button" className="rounded border border-[var(--os-border)] px-2 py-1" onClick={() => void restoreRowsClick([r.key])} data-testid="mpw-restore">Restaurar</button> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
