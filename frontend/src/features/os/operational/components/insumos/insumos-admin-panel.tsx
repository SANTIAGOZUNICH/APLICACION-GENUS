"use client";

/**
 * Administración › INSUMOS: reportes de consumo (por insumo / sector / responsable / período), historial completo con
 * corrección y anulación auditadas, exportación a Excel respetando filtros y administración del catálogo.
 * Los retiros nuevos se ven sin recargar la app: se actualiza al abrir, con «Actualizar» y cada 30 s mientras la pestaña está visible.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { downloadXlsx, exportFileName } from "@/lib/sheet-io";
import { anularRetiroApi, corregirRetiroApi, fetchCatalog, fetchRetiroEvents, fetchRetiros } from "@/lib/insumos/insumos-client";
import { MAX_CANTIDAD } from "@/lib/insumos/insumos-rules";
import { INSUMO_EXPORT_HEADERS, aggregateRetiros, arDayKey, arTime, presetRange, retirosToRows, type Granularity, type PeriodPreset } from "@/lib/insumos/insumos-reports";
import type { CatalogResponse, InsumoFilters, Retiro, RetiroEvent } from "@/lib/insumos/types";
import { SECTOR_LABELS, type SectorId } from "@/types/operational/sector";
import { HBarChart, SeriesChart } from "./insumos-charts";
import { InsumosCatalogAdmin } from "./insumos-catalog-admin";
import { InsumosStockPanel } from "./insumos-stock-panel";
import { InsumosIngresosPanel, InsumosMovimientosPanel } from "./insumos-movimientos";
import { notifyInsumosChanged, useInsumosStock } from "./insumos-stock-client";

const POLL_MS = 20_000;
const field = "min-h-10 w-full rounded-lg border border-[var(--os-border)] bg-[var(--os-surface,transparent)] px-3 text-sm";
const th = "px-2 py-2 text-left text-xs font-semibold uppercase text-[var(--os-text-muted)]";
const td = "px-2 py-2 align-top text-sm";
const fmt = (n: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(n);
const fmtWhen = (iso: string) => {
  const [y, m, d] = arDayKey(iso).split("-");
  return `${d}/${m}/${y} ${arTime(iso)}`;
};
const sectorLabel = (s: string) => SECTOR_LABELS[s as SectorId] ?? s;

type Tab = "stock" | "ingresos" | "consumos" | "movimientos" | "catalogo";
type Modal = { kind: "anular" | "corregir" | "auditoria"; retiro: Retiro } | null;

export function InsumosAdminPanel() {
  const [tab, setTabRaw] = useState<Tab>("stock");
  const [ingresoFor, setIngresoFor] = useState<string | null>(null);
  const stock = useInsumosStock({ pollMs: POLL_MS });
  const setTab = (t: Tab) => {
    setIngresoFor(null);
    setTabRaw(t);
  };
  const [filters, setFilters] = useState<InsumoFilters>(() => presetRange("mes"));
  const [preset, setPreset] = useState<PeriodPreset | "todo" | null>("mes");
  const [gran, setGran] = useState<Granularity>("day");
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [retiros, setRetiros] = useState<Retiro[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const modalOpen = useRef(false);
  const reqSeq = useRef(0);

  useEffect(() => {
    modalOpen.current = Boolean(modal);
  }, [modal]);

  const loadCatalog = useCallback(async () => {
    try {
      setCatalog(await fetchCatalog(true));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el catálogo.");
    }
  }, []);

  const load = useCallback(
    async (silent = false) => {
      const seq = ++reqSeq.current;
      await Promise.resolve(); // el estado se actualiza siempre de forma asíncrona (también al montar o cambiar filtros)
      if (!silent) setLoading(true);
      try {
        const res = await fetchRetiros(filters);
        if (seq !== reqSeq.current) return; // llegó una respuesta más nueva
        setRetiros(res.retiros);
        setTruncated(res.truncated);
        setUpdatedAt(new Date());
        setError(null);
      } catch (e) {
        if (seq === reqSeq.current) setError(e instanceof Error ? e.message : "No se pudo actualizar el historial.");
      } finally {
        if (seq === reqSeq.current) setLoading(false);
      }
    },
    [filters]
  );

  useEffect(() => {
    const t = setTimeout(() => void loadCatalog(), 0);
    return () => clearTimeout(t);
  }, [loadCatalog]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0); // carga al abrir y al cambiar un filtro
    return () => clearTimeout(t);
  }, [load]);
  // Actualización suave: cada 30 s con la pestaña visible y sin un diálogo abierto.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && !modalOpen.current) void load(true);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const agg = useMemo(() => aggregateRetiros(retiros, filters, gran), [retiros, filters, gran]);
  const items = useMemo(() => catalog?.items ?? [], [catalog]);
  const allResponsables = useMemo(() => catalog?.responsables ?? [], [catalog]);
  const respOptions = allResponsables.filter((r) => !filters.sector || r.sector === filters.sector);
  const sorted = useMemo(() => [...retiros].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [retiros]);

  const setF = (patch: Partial<InsumoFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    if ("from" in patch || "to" in patch) setPreset(null);
  };
  const applyPreset = (p: PeriodPreset | "todo") => {
    setPreset(p);
    setFilters((f) => ({ ...f, ...(p === "todo" ? { from: undefined, to: undefined } : presetRange(p)) }));
  };

  async function exportXlsx() {
    await downloadXlsx(exportFileName("insumos", "xlsx"), "Insumos", INSUMO_EXPORT_HEADERS, retirosToRows(retiros, filters));
  }

  const afterChange = async (msg: string) => {
    setModal(null);
    setNotice(msg);
    notifyInsumosChanged(); // el stock cambió (descuento / reversa): se refresca sin recargar
    await load(true);
  };

  const presetBtn = (p: PeriodPreset | "todo", label: string) => (
    <Button key={p} size="sm" variant={preset === p ? "primary" : "secondary"} aria-pressed={preset === p} onClick={() => applyPreset(p)} data-testid={`insumos-preset-${p}`}>{label}</Button>
  );

  return (
    <div className="space-y-4" data-testid="insumos-admin">
      <div role="tablist" className="flex flex-wrap gap-2" aria-label="Insumos">
        {([["stock", "STOCK ACTUAL"], ["ingresos", "INGRESOS"], ["consumos", "CONSUMOS"], ["movimientos", "HISTORIAL DE MOVIMIENTOS"], ["catalogo", "CATÁLOGO Y RESPONSABLES"]] as const).map(([id, label]) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)} data-testid={`insumos-tab-${id}`} className={`min-h-11 rounded-lg border px-4 text-sm font-medium ${tab === id ? "border-[var(--os-teal)] bg-[var(--os-teal)]/15" : "border-[var(--os-border)]"}`}>
            {label}
            {id === "stock" && (stock.summary?.alertCount ?? 0) > 0 ? <span className="ml-1.5 rounded bg-rose-600 px-1.5 text-xs font-bold text-white" data-testid="insumos-tab-stock-alertas">{stock.summary?.alertCount}</span> : null}
          </button>
        ))}
      </div>

      {error ? <p role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300" data-testid="insumos-admin-error">{error}</p> : null}
      {notice ? <p role="status" className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm" data-testid="insumos-admin-aviso">{notice}</p> : null}

      {tab === "stock" ? <InsumosStockPanel summary={stock.summary} error={stock.error} onChanged={() => void stock.reload()} onIngresar={(id) => { setIngresoFor(id); setTabRaw("ingresos"); }} /> : null}
      {tab === "ingresos" ? <InsumosIngresosPanel key={ingresoFor ?? "ingresos"} summary={stock.summary} preselect={ingresoFor} onChanged={() => { void stock.reload(); notifyInsumosChanged(); }} /> : null}
      {tab === "movimientos" ? <InsumosMovimientosPanel summary={stock.summary} /> : null}
      {tab === "catalogo" ? (
        catalog ? <InsumosCatalogAdmin items={items} responsables={allResponsables} onChanged={async () => { await loadCatalog(); notifyInsumosChanged(); }} /> : <p className="text-sm text-[var(--os-text-muted)]">Cargando…</p>
      ) : null}
      {tab === "consumos" ? (
        <>
          {/* Filtros */}
          <section className="space-y-3 rounded-xl border border-[var(--os-border)] p-3" aria-label="Filtros">
            <div className="flex flex-wrap items-center gap-2">
              {presetBtn("hoy", "Hoy")}
              {presetBtn("semana", "Esta semana")}
              {presetBtn("mes", "Este mes")}
              {presetBtn("todo", "Todo")}
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <label className="text-xs">Desde<input type="date" className={field} value={filters.from ?? ""} onChange={(e) => setF({ from: e.target.value || undefined })} data-testid="insumos-filtro-desde" /></label>
              <label className="text-xs">Hasta<input type="date" className={field} value={filters.to ?? ""} onChange={(e) => setF({ to: e.target.value || undefined })} data-testid="insumos-filtro-hasta" /></label>
              <label className="text-xs">Sector
                <select className={field} value={filters.sector ?? ""} onChange={(e) => setF({ sector: e.target.value || undefined, responsableId: undefined })} data-testid="insumos-filtro-sector">
                  <option value="">Todos</option>
                  {["ELABORACION", "ENVASADO_MASIVO", "ENVASADO_PREMIUM", "CODIFICADO", "MATERIA_PRIMA"].map((s) => <option key={s} value={s}>{sectorLabel(s)}</option>)}
                </select>
              </label>
              <label className="text-xs">Responsable
                <select className={field} value={filters.responsableId ?? ""} onChange={(e) => setF({ responsableId: e.target.value || undefined })} data-testid="insumos-filtro-responsable">
                  <option value="">Todos</option>
                  {respOptions.map((r) => <option key={r.id} value={r.id}>{r.name}{filters.sector ? "" : ` · ${sectorLabel(r.sector)}`}</option>)}
                </select>
              </label>
              <label className="text-xs">Insumo
                <select className={field} value={filters.insumoId ?? ""} onChange={(e) => setF({ insumoId: e.target.value || undefined })} data-testid="insumos-filtro-insumo">
                  <option value="">Todos</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => void load()} disabled={loading} data-testid="insumos-actualizar">
                {loading ? <Loader2 className="mr-1 size-4 animate-spin" /> : <RefreshCw className="mr-1 size-4" />} Actualizar
              </Button>
              <Button size="sm" onClick={() => void exportXlsx()} disabled={retiros.length === 0} data-testid="insumos-exportar">Exportar a Excel</Button>
              <span className="text-xs text-[var(--os-text-muted)]" data-testid="insumos-actualizado">{updatedAt ? `Actualizado ${arTime(updatedAt)} · se refresca solo` : ""}</span>
            </div>
            {truncated ? <p className="text-xs text-amber-700 dark:text-amber-300">Hay más registros que los que se muestran: acotá el período para ver (y exportar) todo.</p> : null}
          </section>

          {/* Resumen */}
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-3" data-testid="insumos-kpis">
            <div className="rounded-xl border border-[var(--os-border)] p-3"><p className="text-xs text-[var(--os-text-muted)]">Retiros</p><p className="text-3xl font-bold tabular-nums" data-testid="kpi-retiros">{fmt(agg.retiros)}</p></div>
            <div className="rounded-xl border border-[var(--os-border)] p-3"><p className="text-xs text-[var(--os-text-muted)]">Unidades retiradas</p><p className="text-3xl font-bold tabular-nums" data-testid="kpi-unidades">{fmt(agg.unidades)}</p></div>
            <div className="col-span-2 rounded-xl border border-[var(--os-border)] p-3 lg:col-span-1"><p className="text-xs text-[var(--os-text-muted)]">Insumos distintos</p><p className="text-3xl font-bold tabular-nums">{fmt(agg.porInsumo.length)}</p></div>
          </section>
          <p className="text-xs text-[var(--os-text-muted)]">Los retiros anulados no suman en los totales (se ven en el historial, marcados).</p>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2 rounded-xl border border-[var(--os-border)] p-3">
              <h3 className="font-semibold">Cantidades por insumo</h3>
              <HBarChart testId="grafico-insumos" rows={agg.porInsumo.map((i) => ({ key: i.insumoId, label: i.insumoName, value: i.cantidad }))} />
            </div>
            <div className="space-y-2 rounded-xl border border-[var(--os-border)] p-3">
              <h3 className="font-semibold">Consumo por sector</h3>
              <HBarChart testId="grafico-sectores" rows={agg.porSector.map((s) => ({ key: s.sector, label: sectorLabel(s.sector), value: s.unidades }))} />
            </div>
            <div className="space-y-2 rounded-xl border border-[var(--os-border)] p-3">
              <h3 className="font-semibold">Consumo por responsable</h3>
              <HBarChart testId="grafico-responsables" rows={agg.porResponsable.map((r) => ({ key: r.responsableId, label: `${r.responsableName} · ${sectorLabel(r.sector)}`, value: r.unidades }))} />
            </div>
            <div className="space-y-2 rounded-xl border border-[var(--os-border)] p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">Consumo en el tiempo</h3>
                <select className="min-h-9 rounded-lg border border-[var(--os-border)] bg-[var(--os-surface,transparent)] px-2 text-sm" value={gran} onChange={(e) => setGran(e.target.value as Granularity)} aria-label="Agrupar por" data-testid="insumos-granularidad">
                  <option value="day">Diario</option>
                  <option value="week">Semanal</option>
                  <option value="month">Mensual</option>
                </select>
              </div>
              <SeriesChart testId="grafico-serie" points={agg.serie} />
            </div>
          </section>

          {/* Tablas resumen */}
          <section className="grid gap-4 lg:grid-cols-2">
            <SummaryTable title="Por insumo" testId="tabla-insumos" head={["Insumo", "Cantidad", "Retiros"]} rows={agg.porInsumo.map((i) => [i.insumoName, fmt(i.cantidad), fmt(i.retiros)])} />
            <SummaryTable title="Por sector" testId="tabla-sectores" head={["Sector", "Unidades", "Retiros"]} rows={agg.porSector.map((s) => [sectorLabel(s.sector), fmt(s.unidades), fmt(s.retiros)])} />
            <SummaryTable title="Por responsable" testId="tabla-responsables" head={["Responsable", "Sector", "Unidades", "Retiros"]} rows={agg.porResponsable.map((r) => [r.responsableName, sectorLabel(r.sector), fmt(r.unidades), fmt(r.retiros)])} />
            <SummaryTable title={gran === "day" ? "Por día" : gran === "week" ? "Por semana" : "Por mes"} testId="tabla-serie" head={["Período", "Unidades"]} rows={[...agg.serie].reverse().map((p) => [p.label, fmt(p.total)])} />
          </section>

          {/* Historial */}
          <section className="space-y-2" aria-label="Historial">
            <h3 className="text-lg font-semibold">Historial de retiros <span className="text-sm font-normal text-[var(--os-text-muted)]">({sorted.length})</span></h3>
            <div className="overflow-x-auto rounded-xl border border-[var(--os-border)]">
              <table className="w-full min-w-[56rem] text-left" data-testid="insumos-historial">
                <thead><tr><th className={th}>Fecha y hora</th><th className={th}>Sector</th><th className={th}>Responsable</th><th className={th}>Insumos</th><th className={th}>Registró</th><th className={th}>Estado</th><th className={th}>Acciones</th></tr></thead>
                <tbody className="divide-y divide-[var(--os-border)]">
                  {sorted.map((r) => (
                    <tr key={r.id} className={r.status === "ANULADO" ? "opacity-60" : ""} data-testid={`retiro-${r.id}`} data-status={r.status}>
                      <td className={`${td} whitespace-nowrap`}>{fmtWhen(r.createdAt)}</td>
                      <td className={td}>{sectorLabel(r.sector)}</td>
                      <td className={td}>{r.responsableName}</td>
                      <td className={td}>{r.lines.map((l) => `${l.insumoName} × ${l.cantidad}`).join(" · ")}</td>
                      <td className={td}>{r.registradoPorName || r.registradoPorEmail}</td>
                      <td className={td}>{r.status === "ANULADO" ? <span className="rounded bg-rose-500/15 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:text-rose-300" title={r.anuladoMotivo ?? ""}>ANULADO</span> : <span className="text-xs">Activo</span>}</td>
                      <td className={td}>
                        <div className="flex flex-wrap gap-1">
                          <Button size="sm" variant="secondary" onClick={() => setModal({ kind: "auditoria", retiro: r })} data-testid="retiro-auditoria">Historial</Button>
                          {r.status === "ACTIVO" ? <Button size="sm" variant="secondary" onClick={() => setModal({ kind: "corregir", retiro: r })} data-testid="retiro-corregir">Corregir</Button> : null}
                          {r.status === "ACTIVO" ? <Button size="sm" variant="secondary" onClick={() => setModal({ kind: "anular", retiro: r })} data-testid="retiro-anular">Anular</Button> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {sorted.length === 0 ? <tr><td className={td} colSpan={7}>{loading ? "Cargando…" : "No hay retiros para los filtros elegidos."}</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {modal?.kind === "anular" ? <AnularDialog retiro={modal.retiro} onClose={() => setModal(null)} onDone={() => void afterChange("Retiro anulado. Ya no suma en los totales; queda en el historial.")} /> : null}
      {modal?.kind === "corregir" ? <CorregirDialog retiro={modal.retiro} catalog={catalog} onClose={() => setModal(null)} onDone={() => void afterChange("Retiro corregido. El cambio quedó auditado.")} /> : null}
      {modal?.kind === "auditoria" ? <AuditoriaDialog retiro={modal.retiro} onClose={() => setModal(null)} /> : null}
    </div>
  );
}

function SummaryTable({ title, head, rows, testId }: { title: string; head: string[]; rows: string[][]; testId: string }) {
  return (
    <div className="space-y-2 rounded-xl border border-[var(--os-border)] p-3">
      <h3 className="font-semibold">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left" data-testid={testId}>
          <thead><tr>{head.map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-[var(--os-border)]">
            {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={`${td} ${j === r.length - 1 || (j > 0 && /^\d/.test(c)) ? "tabular-nums" : ""}`}>{c}</td>)}</tr>)}
            {rows.length === 0 ? <tr><td className={td} colSpan={head.length}>Sin datos.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AnularDialog({ retiro, onClose, onDone }: { retiro: Retiro; onClose: () => void; onDone: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await anularRetiroApi(retiro.id, motivo);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo anular.");
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="w-[min(30rem,calc(100vw-24px))]" data-testid="insumos-dialogo-anular">
        <DialogTitle>Anular retiro</DialogTitle>
        <DialogDescription>{fmtWhen(retiro.createdAt)} · {sectorLabel(retiro.sector)} · {retiro.responsableName}: {retiro.lines.map((l) => `${l.insumoName} × ${l.cantidad}`).join(", ")}. No se borra: queda marcado como anulado y no suma en los totales.</DialogDescription>
        <label className="text-sm">Motivo (obligatorio)<textarea className={`${field} min-h-20 py-2`} value={motivo} onChange={(e) => setMotivo(e.target.value)} data-testid="anular-motivo" /></label>
        {err ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{err}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={() => void go()} disabled={busy || motivo.trim().length < 3} data-testid="anular-confirmar">{busy ? "Anulando…" : "Anular retiro"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CorregirDialog({ retiro, catalog, onClose, onDone }: { retiro: Retiro; catalog: CatalogResponse | null; onClose: () => void; onDone: () => void }) {
  const current = useMemo(() => Object.fromEntries(retiro.lines.map((l) => [l.insumoId, l.cantidad])), [retiro]);
  const [qty, setQty] = useState<Record<string, number>>(current);
  const [responsableId, setResponsableId] = useState(retiro.responsableId);
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const options = (catalog?.items ?? []).filter((i) => i.active || current[i.id] !== undefined);
  const resps = (catalog?.responsables ?? []).filter((r) => r.sector === retiro.sector && (r.active || r.id === retiro.responsableId));
  const any = Object.values(qty).some((n) => n > 0);
  const changed = responsableId !== retiro.responsableId || options.some((i) => (qty[i.id] ?? 0) !== (current[i.id] ?? 0));
  async function go() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await corregirRetiroApi(retiro.id, {
        motivo,
        ...(responsableId !== retiro.responsableId ? { responsableId } : {}),
        lines: options.filter((i) => (qty[i.id] ?? 0) > 0).map((i) => ({ insumoId: i.id, cantidad: qty[i.id]! })),
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo corregir.");
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92dvh] w-[min(34rem,calc(100vw-24px))] overflow-y-auto" data-testid="insumos-dialogo-corregir">
        <DialogTitle>Corregir retiro</DialogTitle>
        <DialogDescription>{fmtWhen(retiro.createdAt)} · {sectorLabel(retiro.sector)} · registró {retiro.registradoPorName || retiro.registradoPorEmail}. El sector no se cambia; el cambio queda auditado (antes y después).</DialogDescription>
        <label className="text-sm">Responsable
          <select className={field} value={responsableId} onChange={(e) => setResponsableId(e.target.value)} data-testid="corregir-responsable">
            {resps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <ul className="space-y-1.5">
          {options.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 flex-1">{i.name}</span>
              <input type="number" inputMode="numeric" min={0} max={MAX_CANTIDAD} step={1} className="min-h-10 w-24 rounded-lg border border-[var(--os-border)] bg-[var(--os-surface,transparent)] px-2 text-right" value={qty[i.id] ?? 0} onChange={(e) => setQty((q) => ({ ...q, [i.id]: Math.max(0, Math.min(MAX_CANTIDAD, Math.floor(Number(e.target.value) || 0))) }))} aria-label={`Cantidad de ${i.name}`} data-testid={`corregir-cantidad-${i.id}`} />
            </li>
          ))}
        </ul>
        <label className="text-sm">Motivo (obligatorio)<textarea className={`${field} min-h-16 py-2`} value={motivo} onChange={(e) => setMotivo(e.target.value)} data-testid="corregir-motivo" /></label>
        {!any ? <p className="text-xs text-amber-700 dark:text-amber-300">Tiene que quedar al menos un insumo con cantidad mayor a 0 (si no corresponde el retiro, anulalo).</p> : null}
        {err ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{err}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={() => void go()} disabled={busy || !any || !changed || motivo.trim().length < 3} data-testid="corregir-guardar">{busy ? "Guardando…" : "Guardar corrección"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AuditoriaDialog({ retiro, onClose }: { retiro: Retiro; onClose: () => void }) {
  const [events, setEvents] = useState<RetiroEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchRetiroEvents(retiro.id).then((e) => alive && setEvents(e)).catch((e) => alive && setErr(e instanceof Error ? e.message : "No se pudo cargar el historial."));
    return () => {
      alive = false;
    };
  }, [retiro.id]);
  const snap = (s: RetiroEvent["before"]) => (s ? `${s.responsableName}: ${s.lines.map((l) => `${l.insumoName} × ${l.cantidad}`).join(", ") || "sin insumos"}${s.status === "ANULADO" ? " (ANULADO)" : ""}` : "—");
  const label = { CREADO: "Creado", CORREGIDO: "Corregido", ANULADO: "Anulado" } as const;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] w-[min(36rem,calc(100vw-24px))] overflow-y-auto" data-testid="insumos-dialogo-auditoria">
        <DialogTitle>Historial del retiro</DialogTitle>
        <DialogDescription>Eventos inmutables: quién, cuándo, motivo y qué cambió.</DialogDescription>
        {err ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{err}</p> : null}
        {!events && !err ? <p className="text-sm text-[var(--os-text-muted)]">Cargando…</p> : null}
        <ol className="space-y-3">
          {events?.map((e) => (
            <li key={e.id} className="rounded-lg border border-[var(--os-border)] p-3 text-sm" data-testid="evento-retiro">
              <p className="font-semibold">{label[e.action]} · {fmtWhen(e.createdAt)}</p>
              <p className="text-[var(--os-text-muted)]">{e.actorName} ({e.actorEmail}){e.motivo ? ` · Motivo: ${e.motivo}` : ""}</p>
              {e.action !== "CREADO" ? <p className="mt-1">Antes: {snap(e.before)}</p> : null}
              <p>{e.action === "CREADO" ? "Registro" : "Después"}: {snap(e.after)}</p>
            </li>
          ))}
        </ol>
        <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Cerrar</Button></div>
      </DialogContent>
    </Dialog>
  );
}
