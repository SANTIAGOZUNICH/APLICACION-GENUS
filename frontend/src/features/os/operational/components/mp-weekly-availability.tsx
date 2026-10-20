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
import { TONE_BADGE, TONE_CELL, fmtKg, fmtSigned, statusLabel, toneOfStatus, valueClass } from "@/lib/mp-control/availability-tone";
import { matchesProductFilter, type ProductFilter } from "@/lib/mp-control/product-breakdown";
import type { WeeklyAvailability, WeeklyRow } from "@/lib/mp-control/weekly-availability-service";
import { ProductSections } from "./mp-weekly-products";
import { GESTION_LABEL, NoteCell, fmtWhen } from "./mp-weekly-shared";

const fmt = fmtKg;
type View = "productos" | "consolidado";
/** Filtros del resumen: los cinco generales y tres de materias primas (consolidado). */
type ViewFilter = ProductFilter | "MP_PARCIAL" | "MP_SIN_STOCK" | "MP_NO_ID";
const FILTER_CHIPS: Array<{ id: ProductFilter; label: string }> = [
  { id: "TODOS", label: "TODOS" },
  { id: "SUFICIENTES", label: "SUFICIENTES" },
  { id: "CON_FALTANTES", label: "CON FALTANTES" },
  { id: "SIN_STOCK", label: "SIN STOCK" },
  { id: "DATOS_INCOMPLETOS", label: "DATOS INCOMPLETOS" },
];
function rowMatches(estado: AvailabilityStatus, f: ViewFilter): boolean {
  switch (f) {
    case "SUFICIENTES":
      return estado === "SUFICIENTE";
    case "CON_FALTANTES":
      return estado === "FALTANTE" || estado === "SIN STOCK" || estado === "SIN STOCK UTILIZABLE";
    case "SIN_STOCK":
    case "MP_SIN_STOCK":
      return estado === "SIN STOCK" || estado === "SIN STOCK UTILIZABLE";
    case "DATOS_INCOMPLETOS":
      return estado === "MP NO IDENTIFICADA" || estado === "DATOS INCOMPLETOS";
    case "MP_PARCIAL":
      return estado === "FALTANTE";
    case "MP_NO_ID":
      return estado === "MP NO IDENTIFICADA";
    default:
      return true;
  }
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
  const [view, setView] = useState<View>("productos");
  const [filter, setFilter] = useState<ViewFilter>("TODOS");
  const [openSec, setOpenSec] = useState<Record<string, boolean>>({});
  const [restoreSel, setRestoreSel] = useState<Set<string>>(new Set());
  const [confirmRestore, setConfirmRestore] = useState<string[] | null>(null);

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
  async function doRestore(keys: string[]) {
    await restoreRowsClick(keys);
    setNotice(`Se restauraron ${keys.length} materia${keys.length === 1 ? "" : "s"} prima${keys.length === 1 ? "" : "s"} en el control de esta semana.`);
    setConfirmRestore(null);
    setRestoreSel(new Set());
  }
  async function productionAction(id: string, label: string, restore: boolean) {
    try {
      await post("/api/v1/mp-control/weekly/exclude-production", { week: data!.weekStart, items: [{ workItemId: id, label }], restore, reason: "Quitada manualmente del Control semanal" });
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar la producción");
    }
  }

  const rows = (data?.rows ?? []).filter((r) => (!onlyProblems || r.estado !== "SUFICIENTE") && rowMatches(r.estado, filter));
  const rowsByKey = useMemo(() => new Map([...(data?.rows ?? []), ...(data?.excludedRows ?? [])].map((r) => [r.key, r])), [data]);
  const sections = (data?.products ?? []).filter((p) => matchesProductFilter(p, filter === "MP_PARCIAL" ? "CON_FALTANTES" : filter === "MP_SIN_STOCK" ? "SIN_STOCK" : filter === "MP_NO_ID" ? "DATOS_INCOMPLETOS" : filter));
  const pickFilter = (f: ViewFilter, v?: View) => { setFilter(f); if (v) setView(v); };
  const toReview = (data?.rows ?? []).filter((r) => r.state.exclusionToReview);
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
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7" data-testid="mpw-tiles">
            {([
              { id: "prod", label: "Productos programados", value: data.productSummary.products, tone: "unknown" as const, f: "TODOS" as ViewFilter, v: "productos" as View },
              { id: "cubiertos", label: "Fórmula completamente cubierta", value: data.productSummary.covered, tone: "ok" as const, f: "SUFICIENTES" as ViewFilter, v: "productos" as View },
              { id: "faltantes", label: "Productos con faltantes", value: data.productSummary.withShortage, tone: "partial" as const, f: "CON_FALTANTES" as ViewFilter, v: "productos" as View },
              { id: "mp-parcial", label: "MP con faltante parcial", value: data.productSummary.mpPartial, tone: "partial" as const, f: "MP_PARCIAL" as ViewFilter, v: "consolidado" as View },
              { id: "mp-sin-stock", label: "MP sin stock", value: data.productSummary.mpNone, tone: "none" as const, f: "MP_SIN_STOCK" as ViewFilter, v: "consolidado" as View },
              { id: "mp-no-id", label: "MP no identificadas", value: data.productSummary.mpUnidentified, tone: "unknown" as const, f: "MP_NO_ID" as ViewFilter, v: "consolidado" as View },
              { id: "incompletos", label: "Necesidades con datos incompletos", value: data.productSummary.incompleteNeeds, tone: "unknown" as const, f: "DATOS_INCOMPLETOS" as ViewFilter, v: "productos" as View },
            ]).map((t) => (
              <button key={t.id} type="button" onClick={() => pickFilter(t.f, t.v)} className={`min-h-16 rounded-lg border px-3 py-2 text-left ${TONE_BADGE[t.tone]} ${filter === t.f ? "ring-2 ring-[var(--os-teal)]" : ""}`} data-testid={`mpw-tile-${t.id}`}>
                <span className="block text-2xl font-bold leading-none" data-testid={`mpw-tile-value-${t.id}`}>{t.value}</span>
                <span className="mt-1 block text-[11px] leading-tight">{t.label}</span>
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="mpw-filters">
            {FILTER_CHIPS.map((c) => (
              <button key={c.id} type="button" onClick={() => setFilter(c.id)} aria-pressed={filter === c.id} className={`min-h-11 rounded-full border px-4 text-xs font-semibold ${filter === c.id ? "border-[var(--os-teal)] bg-[var(--os-teal)]/20" : "border-[var(--os-border)]"}`} data-testid={`mpw-filter-${c.id}`}>{c.label}</button>
            ))}
            {filter === "MP_PARCIAL" || filter === "MP_SIN_STOCK" || filter === "MP_NO_ID" ? <button type="button" className="min-h-11 rounded-full border border-[var(--os-border)] px-4 text-xs" onClick={() => setFilter("TODOS")}>Quitar filtro de MP ✕</button> : null}
          </div>
          <div role="tablist" aria-label="Vista del control semanal" className="mt-3 flex flex-wrap items-center gap-2">
            {([["productos", "Por producto y fórmula"], ["consolidado", "Consolidado para compras"]] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)} className={`min-h-11 rounded-lg border px-4 text-sm font-semibold ${view === id ? "border-[var(--os-teal)] bg-[var(--os-teal)]/15" : "border-[var(--os-border)]"}`} data-testid={`mpw-view-${id}`}>{label}</button>
            ))}
            {view === "productos" ? (
              <>
                <Button type="button" size="sm" variant="secondary" className="min-h-11" onClick={() => setOpenSec(Object.fromEntries(data.products.map((p) => [p.id, true])))} data-testid="mpw-expand-all">Expandir todo</Button>
                <Button type="button" size="sm" variant="secondary" className="min-h-11" onClick={() => setOpenSec(Object.fromEntries(data.products.map((p) => [p.id, false])))} data-testid="mpw-collapse-all">Contraer todo</Button>
              </>
            ) : null}
            <label className="ml-auto flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" className="size-5" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Solo lo que requiere atención</label>
          </div>
          {view === "consolidado" ? (
            <p className="mt-2 text-xs text-[var(--os-text-muted)]" data-testid="mpw-consolidated-note">
              Consolidado para compras: una fila por materia prima con la necesidad de TODOS los productos de la semana contra el stock real. El stock se cuenta una sola vez (es compartido), no una vez por producto.
            </p>
          ) : null}
          {confirmRestore ? (
            <div className="mt-2 rounded border border-emerald-400/60 bg-emerald-400/10 p-3" role="alertdialog" data-testid="mpw-restore-confirm">
              <p>Vas a restaurar <b>{confirmRestore.length}</b> materia{confirmRestore.length === 1 ? "" : "s"} prima{confirmRestore.length === 1 ? "" : "s"} en el control de esta semana. No se modifica stock, fórmulas ni OE.</p>
              <div className="mt-2 flex gap-2">
                <Button type="button" size="sm" className="min-h-11" onClick={() => void doRestore(confirmRestore)} data-testid="mpw-restore-yes">Restaurar</Button>
                <Button type="button" size="sm" variant="secondary" className="min-h-11" onClick={() => setConfirmRestore(null)} data-testid="mpw-restore-no">Cancelar</Button>
              </div>
            </div>
          ) : null}
          {toReview.length > 0 ? (
            <p className="mt-2 rounded border border-amber-400/60 bg-amber-400/10 px-3 py-2 text-xs text-amber-100" role="status" data-testid="mpw-review-banner">
              {toReview.length} materia{toReview.length === 1 ? "" : "s"} prima{toReview.length === 1 ? "" : "s"} que se había{toReview.length === 1 ? "" : "n"} quitado vuelve{toReview.length === 1 ? "" : "n"} a mostrarse porque hay necesidades nuevas o mayores: revisalas.
            </p>
          ) : null}

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

          {view === "productos" ? (
            <div className="mt-3">
              <ProductSections
                sections={sections}
                rowsByKey={rowsByKey}
                open={openSec}
                setOpen={(id, v) => setOpenSec((o) => ({ ...o, [id]: v }))}
                canEdit={canEdit}
                selectMode={selectMode}
                selected={selected}
                onToggleSelect={toggle}
                onRemove={(key) => setConfirmDelete([key])}
                onSaveNote={saveNote}
                onSaveGestion={saveGestion}
              />
              {data.products.length === 0 ? <p className="mt-2 text-center text-sm text-[var(--os-text-muted)]">{data.excludedRows.length > 0 ? `No hay productos con necesidades visibles: hay ${data.excludedRows.length} materias primas quitadas de la semana (revisalas más abajo).` : "No hay elaboraciones programadas en esta semana."}</p> : null}
            </div>
          ) : null}
          {view === "consolidado" ? (
          <div className="mt-2 overflow-x-auto" data-testid="mpw-consolidado">
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
                      <td className={`p-1 text-right font-mono ${TONE_CELL[toneOfStatus(r.estado)]} ${valueClass(toneOfStatus(r.estado))}`} data-testid="mpw-util">{r.estado === "MP NO IDENTIFICADA" ? "—" : fmt(r.stockUtilizable)}</td>
                      <td className="p-1 text-right font-mono">{fmt(r.requerido)}</td>
                      <td className="p-1 text-right font-mono">{fmt(r.reservado)}</td>
                      <td className={`p-1 text-right font-mono ${TONE_CELL[toneOfStatus(r.estado)]} ${valueClass(toneOfStatus(r.estado), r.saldoProyectado)}`} data-testid="mpw-saldo">{r.estado === "MP NO IDENTIFICADA" ? "—" : fmtSigned(r.saldoProyectado)}</td>
                      <td className="p-1"><span className={`inline-block rounded border px-2 py-0.5 font-bold ${TONE_BADGE[toneOfStatus(r.estado)]}`} data-testid="mpw-estado">{statusLabel(r.estado)}</span>{r.faltante > 0 ? <span className="ml-1 font-bold text-rose-300" data-testid="mpw-faltante">falta {fmt(r.faltante)} kg</span> : null}{r.related.length > 0 ? <span className="ml-1 text-sky-300" title="Hay descripciones parecidas en el Stock sin sumar">· {r.related.length} parecida{r.related.length > 1 ? "s" : ""}</span> : null}{r.state.exclusionToReview ? <span className="mt-1 block text-amber-300" data-testid="mpw-review">Se había quitado: {r.state.exclusionReviewReason ?? "hay necesidades nuevas"} Revisar.{canEdit ? <button type="button" className="ml-2 min-h-9 rounded border border-amber-400/60 px-2 text-[11px]" onClick={(e) => { e.stopPropagation(); setConfirmDelete([r.key]); }} data-testid="mpw-review-keep">Mantener quitada</button> : null}{canEdit ? <button type="button" className="ml-1 min-h-9 rounded border border-[var(--os-border)] px-2 text-[11px]" onClick={(e) => { e.stopPropagation(); setConfirmRestore([r.key]); }} data-testid="mpw-review-restore">Restaurar</button> : null}</span> : null}</td>
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
                {rows.length === 0 ? <tr><td colSpan={12} className="p-3 text-center text-[var(--os-text-muted)]">{data.rows.length === 0 ? (data.excludedRows.length > 0 ? `Todas las necesidades de esta semana están quitadas del control (${data.excludedRows.length}). Revisalas y restauralas abajo.` : "No hay necesidades de MP para esta semana.") : "Ninguna materia prima con ese filtro."}</td></tr> : null}
              </tbody>
            </table>
          </div>
          ) : null}
          {data.excludedRows.length > 0 || data.excludedProductions.length > 0 ? (
            <details className="mt-3 rounded border border-[var(--os-border)] p-2 text-xs" data-testid="mpw-excluded" open={data.excludedRows.length > 0 && data.rows.length === 0}>
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Quitadas de esta semana: {data.excludedRows.length} materia{data.excludedRows.length === 1 ? "" : "s"} prima{data.excludedRows.length === 1 ? "" : "s"}{data.excludedProductions.length ? ` · ${data.excludedProductions.length} producción${data.excludedProductions.length === 1 ? "" : "es"}` : ""}</summary>
              <p className="mb-2 text-[var(--os-text-muted)]">Quitar nunca borra stock, fórmulas, OE ni movimientos: solo oculta la necesidad de esta semana. Se vuelve a mostrar sola si aparecen necesidades nuevas o mayores. Podés restaurar una por una o varias a la vez.</p>
              {data.excludedRows.length > 0 ? (
                <div data-testid="mpw-excluded-rows">
                  <h4 className="mb-1 font-semibold">Materias primas quitadas por una persona</h4>
                  {canEdit ? (
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Button type="button" size="sm" variant="secondary" className="min-h-11" onClick={() => setRestoreSel(new Set(data.excludedRows.map((r) => r.key)))} data-testid="mpw-restore-all">Seleccionar todas</Button>
                      <Button type="button" size="sm" variant="secondary" className="min-h-11" onClick={() => setRestoreSel(new Set())}>Ninguna</Button>
                      <Button type="button" size="sm" className="min-h-11" disabled={restoreSel.size === 0} onClick={() => setConfirmRestore([...restoreSel])} data-testid="mpw-restore-selected">Restaurar seleccionadas ({restoreSel.size})</Button>
                    </div>
                  ) : null}
                  <ul className="space-y-2">
                    {data.excludedRows.map((r) => (
                      <li key={r.key} className="flex flex-wrap items-start gap-2 rounded border border-[var(--os-border)] p-2" data-testid="mpw-excluded-item">
                        {canEdit ? <input type="checkbox" className="mt-1 size-6" aria-label={`Elegir ${r.materiaPrima}`} checked={restoreSel.has(r.key)} onChange={() => setRestoreSel((cur) => { const n = new Set(cur); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; })} data-testid="mpw-restore-check" /> : null}
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{r.materiaPrima} — la quitó {r.state.excludedBy} el {fmtWhen(r.state.excludedAt)}</p>
                          <p className="text-[var(--os-text-muted)]" data-testid="mpw-excluded-scope">Alcance: toda la MP de esta semana · producciones que la necesitaban: {r.scope?.productionLabels.join(" · ") || "sin detalle guardado"} · necesidad al quitarla: {r.scope?.requeridoAtExclusion != null ? `${fmt(r.scope.requeridoAtExclusion)} kg` : "—"} · hoy: {fmt(r.requerido)} kg</p>
                        </div>
                        {canEdit ? <button type="button" className="min-h-11 rounded border border-[var(--os-border)] px-3" onClick={() => setConfirmRestore([r.key])} data-testid="mpw-restore">Restaurar</button> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {data.excludedProductions.length > 0 ? (
                <div className="mt-3" data-testid="mpw-prod-excluded-panel">
                  {(["control", "manual"] as const).map((kind) => {
                    const list = data.excludedProductions.filter((p) => p.kind === kind);
                    if (list.length === 0) return null;
                    return (
                      <div key={kind} className="mb-2">
                        <h4 className="mb-1 font-semibold">{kind === "control" ? "Producciones quitadas junto con un control eliminado, anulado o archivado" : "Producciones quitadas del cálculo por una persona (solo de esta producción)"}</h4>
                        <ul className="space-y-1">
                          {list.map((p) => (
                            <li key={p.workItemId} className="flex flex-wrap items-center gap-2">
                              <span>{p.label} · {p.by} · {fmtWhen(p.at)}{p.reason ? ` — ${p.reason}` : ""}</span>
                              {canEdit ? <button type="button" className="min-h-11 rounded border border-[var(--os-border)] px-3" onClick={() => void productionAction(p.workItemId, p.label, true)} data-testid="mpw-prod-restore-panel">Volver a sumar</button> : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
