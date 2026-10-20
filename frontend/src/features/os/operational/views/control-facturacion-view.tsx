"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { usePreviewContext } from "@/features/os/session/preview-context";
import { DELIVERY_STATE_LABEL, INVOICING_STATE_LABEL, INVOICING_STATES, type InvoicingState } from "@/lib/billing/billing-state";
import type { BillableDelivery, BillingDashboard, BillingRowView, InvoiceView } from "@/lib/billing/billing-service";

type Tab = "resumen" | "control" | "facturas";
type Filters = { q: string; client: string; product: string; state: string; deliveryState: string; from: string; to: string };
const EMPTY: Filters = { q: "", client: "", product: "", state: "TODOS", deliveryState: "TODOS", from: "", to: "" };

const fieldCls = "min-h-11 rounded-lg border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm";
const nf = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 });
const n = (v: number | null | undefined) => (v == null ? "—" : nf.format(v));
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }) : "—");
const dateTime = (iso: string) => new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
/** Clave de operación: una por apertura del formulario, así un doble clic o reintento no duplica la factura. */
function newOperationKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `inv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

const STATE_CLS: Record<InvoicingState, string> = {
  SIN_ENTREGAS: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  PENDIENTE_DE_FACTURAR: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
  FACTURACION_PARCIAL: "bg-sky-500/20 text-sky-700 dark:text-sky-300",
  FACTURADO: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  CON_INCIDENCIA: "bg-rose-500/20 text-rose-700 dark:text-rose-300",
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store", credentials: "include" });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "No se pudo cargar.");
  return body;
}
async function sendJson<T>(url: string, method: string, payload: unknown): Promise<T> {
  const res = await fetch(url, { method, credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "No se pudo guardar.");
  return body;
}
const qs = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v && v !== "TODOS") p.set(k, v);
  return p.toString();
};

export function ControlFacturacionView({ initialTab }: { initialTab?: Tab } = {}) {
  const { currentNav } = usePreviewContext();
  const [tab, setTab] = useState<Tab>(currentNav.workItemId ? "control" : (initialTab ?? "resumen"));
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [rows, setRows] = useState<BillingRowView[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [dash, setDash] = useState<BillingDashboard | null>(null);
  const [dashFilter, setDashFilter] = useState({ client: "", from: "", to: "" });
  const [invoices, setInvoices] = useState<InvoiceView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [invoiceFor, setInvoiceFor] = useState<BillingRowView[] | null>(null);
  const [detail, setDetail] = useState<BillingRowView | null>(null);
  const workItemFocus = useRef(currentNav.workItemId);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = qs({ q: filters.q, client: filters.client, product: filters.product, state: filters.state, deliveryState: filters.deliveryState, from: filters.from, to: filters.to, workItemId: workItemFocus.current });
      const data = await getJson<{ rows: BillingRowView[]; canWrite: boolean }>(`/api/v1/billing/control?${q}`);
      setRows(data.rows);
      setCanWrite(data.canWrite);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const loadDash = useCallback(async () => {
    try {
      const data = await getJson<{ dashboard: BillingDashboard }>(`/api/v1/billing/dashboard?${qs(dashFilter)}`);
      setDash(data.dashboard);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }, [dashFilter]);

  const loadInvoices = useCallback(async () => {
    try {
      const data = await getJson<{ invoices: InvoiceView[] }>(`/api/v1/billing/invoices?${qs({ client: undefined })}`);
      setInvoices(data.invoices);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }, []);

  useEffect(() => {
    if (tab === "control") queueMicrotask(() => void loadRows());
  }, [tab, loadRows]);
  useEffect(() => {
    if (tab === "resumen") queueMicrotask(() => void loadDash());
  }, [tab, loadDash]);
  useEffect(() => {
    if (tab === "facturas") queueMicrotask(() => void loadInvoices());
  }, [tab, loadInvoices]);

  /** Indicador del resumen → abre la lista correspondiente. */
  function openList(next: Partial<Filters>) {
    workItemFocus.current = undefined;
    setFilters({ ...EMPTY, client: dashFilter.client, ...next });
    setTab("control");
  }

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.key)), [rows, selected]);
  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function startInvoice(list: BillingRowView[]) {
    const clients = new Set(list.map((r) => r.client.trim().toLowerCase()));
    if (clients.size > 1) {
      setError("Una factura corresponde a un solo cliente: seleccioná pedidos del mismo cliente.");
      return;
    }
    setError(null);
    setInvoiceFor(list);
  }
  const exportUrl = (report: string) => `/api/v1/billing/export?${qs({ report, client: dashFilter.client || filters.client, from: dashFilter.from, to: dashFilter.to })}`;

  return (
    <TwinShell title="Control de facturación">
      <div className="space-y-4" data-testid="billing-view">
        <header className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">Control de facturación</h2>
          <p className="text-sm text-[var(--os-text-muted)]">
            Cantidades en unidades, sin importes. <strong>Entregar no es facturar</strong>: acá se registra qué entregas reales ya se facturaron (facturas emitidas fuera de GENUS OS).
          </p>
        </header>

        <div role="tablist" className="flex flex-wrap gap-2" aria-label="Secciones de facturación">
          {([["resumen", "Resumen"], ["control", "Control de facturación"], ["facturas", "Facturas registradas"]] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} type="button" data-testid={`billing-tab-${id}`} onClick={() => setTab(id)} className={`min-h-11 rounded-lg border px-4 text-sm font-medium ${tab === id ? "border-[var(--os-teal)] bg-[var(--os-teal)]/15" : "border-[var(--os-border)]"}`}>
              {label}
            </button>
          ))}
        </div>

        {error ? <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm" data-testid="billing-error">{error}</p> : null}
        {notice ? <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm" data-testid="billing-notice">{notice}</p> : null}

        {tab === "resumen" ? (
          <section className="space-y-4" data-testid="billing-dashboard">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs">Cliente<input className={`${fieldCls} block`} value={dashFilter.client} onChange={(e) => setDashFilter({ ...dashFilter, client: e.target.value })} placeholder="Todos" data-testid="dash-client" /></label>
              <label className="text-xs">Desde<input type="date" className={`${fieldCls} block`} value={dashFilter.from} onChange={(e) => setDashFilter({ ...dashFilter, from: e.target.value })} data-testid="dash-from" /></label>
              <label className="text-xs">Hasta<input type="date" className={`${fieldCls} block`} value={dashFilter.to} onChange={(e) => setDashFilter({ ...dashFilter, to: e.target.value })} data-testid="dash-to" /></label>
              <span className="pb-2 text-xs text-[var(--os-text-muted)]">{dash ? `Período: ${dash.period.from} a ${dash.period.to}` : ""}</span>
            </div>
            {dash ? (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Tile id="pending" label="Pedidos pendientes de facturar" value={dash.ordersPendingInvoice} onClick={() => openList({ state: "PENDIENTE_DE_FACTURAR" })} />
                <Tile id="partial" label="Pedidos con facturación parcial" value={dash.ordersPartiallyInvoiced} onClick={() => openList({ state: "FACTURACION_PARCIAL" })} />
                <Tile id="done" label="Pedidos con todo lo entregado facturado" value={dash.ordersFullyInvoiced} onClick={() => openList({ state: "FACTURADO" })} />
                <Tile id="units-pending" label="Unidades entregadas pendientes de facturar" value={n(dash.unitsPendingInvoice)} onClick={() => openList({ state: "PENDIENTE_DE_FACTURAR" })} />
                <Tile id="units-invoiced" label="Unidades facturadas en el período" value={n(dash.unitsInvoicedInPeriod)} onClick={() => setTab("facturas")} />
                <Tile id="today" label="Entregas realizadas hoy" value={`${dash.deliveriesToday.count} · ${n(dash.deliveriesToday.units)} u.`} onClick={() => openList({ from: todayIso(), to: todayIso(), deliveryState: "TODOS" })} />
                <Tile id="ready" label="Pedidos listos para entregar" value={dash.ordersReadyToDeliver} onClick={() => openList({ state: "SIN_ENTREGAS" })} />
                <Tile id="period" label="Entregas del período" value={`${dash.deliveriesInPeriod.count} · ${n(dash.deliveriesInPeriod.units)} u.`} onClick={() => openList({ from: dash.period.from, to: dash.period.to })} />
              </div>
            ) : (
              <p className="text-sm text-[var(--os-text-muted)]">Cargando resumen…</p>
            )}
            <div>
              <h3 className="mb-2 text-sm font-semibold">Pendiente de facturar por cliente</h3>
              <div className="grid gap-2 md:grid-cols-2" data-testid="dash-by-client">
                {(dash?.pendingByClient ?? []).map((c) => (
                  <button key={c.client} type="button" onClick={() => openList({ client: c.client, state: "PENDIENTE_DE_FACTURAR" })} className="flex min-h-11 items-center justify-between rounded-lg border border-[var(--os-border)] px-3 py-2 text-left text-sm hover:border-[var(--os-teal)]">
                    <span>{c.client}</span>
                    <span className="text-[var(--os-text-muted)]">{c.orders} pedido(s) · {n(c.units)} u.</span>
                  </button>
                ))}
                {dash && dash.pendingByClient.length === 0 ? <p className="text-sm text-[var(--os-text-muted)]">No hay entregas pendientes de facturar.</p> : null}
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Exportar a Excel</h3>
              <div className="flex flex-wrap gap-2" data-testid="billing-exports">
                {[["pendientes", "Pedidos pendientes de facturar"], ["entregas", "Entregas por período"], ["facturacion-cliente", "Facturación por cliente"], ["unidades-producto", "Unidades facturadas por producto"], ["parciales", "Facturación parcial y saldos"]].map(([id, label]) => (
                  <a key={id} href={exportUrl(id)} download className="inline-flex min-h-11 items-center rounded-lg border border-[var(--os-border)] px-3 text-sm hover:border-[var(--os-teal)]" data-testid={`export-${id}`}>{label}</a>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {tab === "control" ? (
          <section className="space-y-3" data-testid="billing-control">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs">Buscar<input className={`${fieldCls} block`} value={filters.q} onChange={(e) => { workItemFocus.current = undefined; setFilters({ ...filters, q: e.target.value }); }} placeholder="Cliente, pedido, producto, remito, factura" data-testid="billing-search" /></label>
              <label className="text-xs">Cliente<input className={`${fieldCls} block w-40`} value={filters.client} onChange={(e) => setFilters({ ...filters, client: e.target.value })} data-testid="billing-f-client" /></label>
              <label className="text-xs">Producto<input className={`${fieldCls} block w-40`} value={filters.product} onChange={(e) => setFilters({ ...filters, product: e.target.value })} data-testid="billing-f-product" /></label>
              <label className="text-xs">Estado de facturación
                <select className={`${fieldCls} block`} value={filters.state} onChange={(e) => setFilters({ ...filters, state: e.target.value })} data-testid="billing-f-state">
                  <option value="TODOS">Todos</option>
                  {INVOICING_STATES.map((s) => <option key={s} value={s}>{INVOICING_STATE_LABEL[s]}</option>)}
                </select>
              </label>
              <label className="text-xs">Estado de entrega
                <select className={`${fieldCls} block`} value={filters.deliveryState} onChange={(e) => setFilters({ ...filters, deliveryState: e.target.value })} data-testid="billing-f-delivery">
                  <option value="TODOS">Todos</option>
                  {Object.entries(DELIVERY_STATE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="text-xs">Última entrega desde<input type="date" className={`${fieldCls} block`} value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} data-testid="billing-f-from" /></label>
              <label className="text-xs">hasta<input type="date" className={`${fieldCls} block`} value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} data-testid="billing-f-to" /></label>
              <Button type="button" variant="secondary" onClick={() => { workItemFocus.current = undefined; setFilters(EMPTY); }}>Limpiar</Button>
            </div>
            <p className="text-xs text-[var(--os-text-muted)]" data-testid="billing-count">{loading ? "Cargando…" : `${rows.length} pedido(s)`}</p>
            <div className="overflow-x-auto rounded-lg border border-[var(--os-border)]">
              <table className="w-full min-w-[1400px] text-left text-xs" data-testid="billing-table">
                <thead className="bg-[var(--os-surface-2,transparent)] text-[11px] uppercase tracking-wide text-[var(--os-text-muted)]">
                  <tr>
                    {canWrite ? <th className="px-2 py-2" aria-label="Seleccionar" /> : null}
                    {["Cliente", "Pedido", "Producto", "OE/OA", "Pedida", "Entregada", "Pend. entregar", "Facturada", "Entregada s/facturar", "Remito", "Factura", "Últ. entrega", "Fecha factura", "Estado", "Observaciones", ""].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className="border-t border-[var(--os-border)] align-top" data-testid="billing-row" data-state={r.invoicingState} data-client={r.client}>
                      {canWrite ? <td className="px-2 py-2"><input type="checkbox" className="size-5" checked={selected.has(r.key)} onChange={() => toggle(r.key)} disabled={r.pendingInvoice <= 0} aria-label={`Seleccionar ${r.product}`} data-testid="billing-select" /></td> : null}
                      <td className="px-2 py-2 font-medium">{r.client}</td>
                      <td className="px-2 py-2">{r.pedido ?? "—"}</td>
                      <td className="px-2 py-2">{r.product}</td>
                      <td className="px-2 py-2">{r.orderRef ?? "—"}</td>
                      <td className="px-2 py-2 tabular-nums">{n(r.requested)}</td>
                      <td className="px-2 py-2 tabular-nums" data-testid="cell-delivered">{n(r.delivered)}</td>
                      <td className="px-2 py-2 tabular-nums">{n(r.pendingDelivery)}</td>
                      <td className="px-2 py-2 tabular-nums" data-testid="cell-invoiced">{n(r.invoiced)}</td>
                      <td className="px-2 py-2 font-semibold tabular-nums" data-testid="cell-pending-invoice">{n(r.pendingInvoice)}</td>
                      <td className="px-2 py-2">{r.remitos.join(", ") || "—"}</td>
                      <td className="px-2 py-2">{r.invoices.join(", ") || "—"}</td>
                      <td className="px-2 py-2">{day(r.lastDeliveryAt)}</td>
                      <td className="px-2 py-2">{r.lastInvoiceDate ? r.lastInvoiceDate.split("-").reverse().join("/") : "—"}</td>
                      <td className="px-2 py-2">
                        <span className={`inline-block rounded px-2 py-0.5 font-semibold ${STATE_CLS[r.invoicingState]}`} data-testid="cell-state">{INVOICING_STATE_LABEL[r.invoicingState]}</span>
                        <div className="mt-1 text-[11px] text-[var(--os-text-muted)]" data-testid="cell-delivery-state">{DELIVERY_STATE_LABEL[r.deliveryState]}</div>
                      </td>
                      <td className="max-w-[16rem] px-2 py-2">{r.incidence ? <span className="text-rose-600">{r.incidence} </span> : null}{r.observations ?? ""}</td>
                      <td className="whitespace-nowrap px-2 py-2">
                        <button type="button" className="mr-2 min-h-11 rounded border border-[var(--os-border)] px-2" onClick={() => setDetail(r)} data-testid="billing-detail">Detalle</button>
                        {canWrite && r.pendingInvoice > 0 ? <button type="button" className="min-h-11 rounded bg-[var(--os-teal)] px-3 font-semibold text-white" onClick={() => startInvoice([r])} data-testid="billing-invoice-row">Facturar</button> : null}
                      </td>
                    </tr>
                  ))}
                  {!loading && rows.length === 0 ? <tr><td colSpan={17} className="px-3 py-6 text-center text-[var(--os-text-muted)]">No hay pedidos con esos filtros.</td></tr> : null}
                </tbody>
              </table>
            </div>
            {canWrite && selectedRows.length > 0 ? (
              <div className="sticky bottom-2 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--os-teal)] bg-[var(--os-surface)] p-3 shadow-xl sm:max-w-[calc(100%-26rem)]" data-testid="billing-selection-bar">
                <Button type="button" onClick={() => startInvoice(selectedRows)} data-testid="billing-invoice-selected">Facturar seleccionados ({selectedRows.length})</Button>
                <Button type="button" variant="secondary" onClick={() => setSelected(new Set())}>Quitar selección</Button>
                <span className="text-sm">{n(selectedRows.reduce((sum, r) => sum + r.pendingInvoice, 0))} u. entregadas pendientes de facturar</span>
              </div>
            ) : null}
          </section>
        ) : null}

        {tab === "facturas" ? (
          <section className="space-y-3" data-testid="billing-invoices">
            {invoices.map((inv) => (
              <InvoiceCard key={inv.id} inv={inv} canWrite={canWrite} onChanged={() => { setNotice("Factura anulada: sus unidades volvieron a «pendientes de facturar»."); void loadInvoices(); }} onError={setError} />
            ))}
            {invoices.length === 0 ? <p className="text-sm text-[var(--os-text-muted)]">Todavía no hay facturas registradas.</p> : null}
          </section>
        ) : null}
      </div>

      {invoiceFor ? (
        <InvoiceModal
          rows={invoiceFor}
          onClose={() => setInvoiceFor(null)}
          onDone={(msg) => { setInvoiceFor(null); setSelected(new Set()); setNotice(msg); setError(null); void loadRows(); }}
        />
      ) : null}
      {detail ? <DetailModal row={detail} canWrite={canWrite} onClose={() => setDetail(null)} onSaved={() => { setDetail(null); void loadRows(); }} /> : null}
    </TwinShell>
  );
}

function Tile({ id, label, value, onClick }: { id: string; label: string; value: number | string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-h-24 rounded-xl border border-[var(--os-border)] bg-[var(--os-surface)] p-3 text-left hover:border-[var(--os-teal)]" data-testid={`dash-tile-${id}`}>
      <div className="text-2xl font-semibold tabular-nums" data-testid={`dash-value-${id}`}>{value}</div>
      <div className="mt-1 text-xs text-[var(--os-text-muted)]">{label}</div>
    </button>
  );
}

function InvoiceModal({ rows, onClose, onDone }: { rows: BillingRowView[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [deliveries, setDeliveries] = useState<BillableDelivery[] | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(todayIso());
  const [obs, setObs] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [idemKey] = useState(newOperationKey);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const all: BillableDelivery[] = [];
        for (const r of rows) {
          const data = await getJson<{ deliveries: BillableDelivery[] }>(`/api/v1/billing/deliveries?${qs({ rootKey: r.key, onlyPending: "1" })}`);
          all.push(...data.deliveries);
        }
        if (!alive) return;
        setDeliveries(all);
        setChecked(new Set(all.map((d) => d.deliveryLineId)));
        setQty(Object.fromEntries(all.map((d) => [d.deliveryLineId, String(d.available)])));
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : "Error");
      }
    })();
    return () => { alive = false; };
  }, [rows]);

  const total = useMemo(() => (deliveries ?? []).filter((d) => checked.has(d.deliveryLineId)).reduce((s, d) => s + (Number(qty[d.deliveryLineId]) || 0), 0), [deliveries, checked, qty]);

  async function submit() {
    setErr(null);
    const lines = (deliveries ?? []).filter((d) => checked.has(d.deliveryLineId)).map((d) => ({ deliveryLineId: d.deliveryLineId, quantity: Number(String(qty[d.deliveryLineId]).replace(",", ".")) }));
    if (lines.length === 0) return setErr("Elegí al menos una entrega.");
    setBusy(true);
    try {
      const res = await sendJson<{ invoiceNumber: string; units: number; replayed: boolean }>("/api/v1/billing/invoices", "POST", { invoiceNumber: number, invoiceDate: date, observations: obs, lines, idempotencyKey: idemKey });
      onDone(res.replayed ? `La factura ${res.invoiceNumber} ya estaba registrada (no se duplicó).` : `Factura ${res.invoiceNumber} registrada: ${nf.format(res.units)} u.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 p-2 sm:items-center" role="dialog" aria-modal="true" aria-label="Registrar facturación" data-testid="invoice-modal">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-[var(--os-surface)] p-4 text-[var(--os-text)] shadow-2xl">
        <h3 className="text-lg font-semibold">Registrar facturación — {rows[0]?.client}</h3>
        <p className="text-xs text-[var(--os-text-muted)]">Factura emitida fuera de GENUS OS. No mueve stock ni cambia lo entregado.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-xs">Número de factura<input className={`${fieldCls} block w-full`} value={number} onChange={(e) => setNumber(e.target.value)} data-testid="invoice-number" /></label>
          <label className="text-xs">Fecha de factura<input type="date" className={`${fieldCls} block w-full`} value={date} onChange={(e) => setDate(e.target.value)} data-testid="invoice-date" /></label>
        </div>
        <label className="mt-2 block text-xs">Observaciones (opcional)<textarea className={`${fieldCls} block w-full`} rows={2} value={obs} onChange={(e) => setObs(e.target.value)} data-testid="invoice-obs" /></label>
        <div className="mt-3 space-y-2" data-testid="invoice-deliveries">
          {deliveries === null && !err ? <p className="text-sm">Cargando entregas…</p> : null}
          {deliveries?.length === 0 ? <p className="text-sm">No hay entregas pendientes de facturar en lo seleccionado.</p> : null}
          {deliveries?.map((d) => (
            <div key={d.deliveryLineId} className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--os-border)] p-2 text-sm" data-testid="invoice-delivery">
              <input type="checkbox" className="size-5" checked={checked.has(d.deliveryLineId)} onChange={() => setChecked((p) => { const nx = new Set(p); if (nx.has(d.deliveryLineId)) nx.delete(d.deliveryLineId); else nx.add(d.deliveryLineId); return nx; })} aria-label={`Incluir entrega de ${d.product}`} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{d.product} <span className="text-xs text-[var(--os-text-muted)]">{d.orderRef ?? ""}</span></div>
                <div className="text-xs text-[var(--os-text-muted)]">{dateTime(d.deliveredAt)} · {d.kind === "FINAL" ? "final" : "parcial"} · entregadas {n(d.quantity)} · ya facturadas {n(d.invoiced)} · disponibles {n(d.available)}{d.remito ? ` · remito ${d.remito}` : ""}</div>
              </div>
              <label className="text-xs">A facturar<input inputMode="decimal" className={`${fieldCls} block w-28`} value={qty[d.deliveryLineId] ?? ""} onChange={(e) => setQty({ ...qty, [d.deliveryLineId]: e.target.value })} data-testid="invoice-qty" /></label>
            </div>
          ))}
        </div>
        {err ? <p role="alert" className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-sm" data-testid="invoice-error">{err}</p> : null}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm">Total a facturar: <strong data-testid="invoice-total">{n(total)}</strong> u.</span>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button type="button" onClick={() => void submit()} disabled={busy || !deliveries?.length} data-testid="invoice-submit">{busy ? "Registrando…" : "Registrar facturación"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailModal({ row, canWrite, onClose, onSaved }: { row: BillingRowView; canWrite: boolean; onClose: () => void; onSaved: () => void }) {
  const [deliveries, setDeliveries] = useState<BillableDelivery[]>([]);
  const [note, setNote] = useState(row.observations ?? "");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void getJson<{ deliveries: BillableDelivery[] }>(`/api/v1/billing/deliveries?${qs({ rootKey: row.key })}`).then((d) => setDeliveries(d.deliveries)).catch((e) => setErr(e instanceof Error ? e.message : "Error"));
  }, [row.key]);
  async function save() {
    try {
      await sendJson("/api/v1/billing/note", "PUT", { rootKey: row.key, observations: note });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    }
  }
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 p-2 sm:items-center" role="dialog" aria-modal="true" aria-label="Detalle de facturación" data-testid="billing-detail-modal">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-[var(--os-surface)] p-4 text-[var(--os-text)] shadow-2xl">
        <h3 className="text-lg font-semibold">{row.client} · {row.product}</h3>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          {([["Pedida", row.requested], ["Producida", row.produced], ["Entregada", row.delivered], ["Facturada", row.invoiced]] as const).map(([l, v]) => <div key={l}><dt className="text-xs text-[var(--os-text-muted)]">{l}</dt><dd className="font-semibold tabular-nums">{n(v)}</dd></div>)}
        </dl>
        <h4 className="mt-3 text-sm font-semibold">Entregas reales</h4>
        <ul className="space-y-1 text-sm" data-testid="detail-deliveries">
          {deliveries.map((d) => <li key={d.deliveryLineId} className="rounded border border-[var(--os-border)] px-2 py-1">{dateTime(d.deliveredAt)} · {n(d.quantity)} u. · facturadas {n(d.invoiced)} · pendientes {n(d.available)}{d.remito ? ` · remito ${d.remito}` : ""}</li>)}
          {deliveries.length === 0 ? <li className="text-[var(--os-text-muted)]">Sin entregas.</li> : null}
        </ul>
        <label className="mt-3 block text-xs">Observaciones de Administración
          <textarea className={`${fieldCls} block w-full`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} readOnly={!canWrite} data-testid="detail-note" />
        </label>
        {err ? <p role="alert" className="mt-2 text-sm text-rose-600">{err}</p> : null}
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cerrar</Button>
          {canWrite ? <Button type="button" onClick={() => void save()} data-testid="detail-save">Guardar observaciones</Button> : null}
        </div>
      </div>
    </div>
  );
}

function InvoiceCard({ inv, canWrite, onChanged, onError }: { inv: InvoiceView; canWrite: boolean; onChanged: () => void; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);
  async function annul() {
    try {
      await sendJson(`/api/v1/billing/invoices/${inv.id}`, "DELETE", { reason });
      setAsking(false);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Error");
    }
  }
  return (
    <article className="rounded-lg border border-[var(--os-border)] p-3 text-sm" data-testid="invoice-card" data-status={inv.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <strong>Factura {inv.invoiceNumber}</strong> · {inv.client} · {inv.invoiceDate.split("-").reverse().join("/")} · {n(inv.units)} u.
          {inv.status !== "ACTIVA" ? <span className="ml-2 rounded bg-rose-500/20 px-2 py-0.5 text-xs font-semibold">ANULADA</span> : null}
        </div>
        <div className="flex gap-2">
          <button type="button" className="min-h-11 rounded border border-[var(--os-border)] px-3" onClick={() => setOpen(!open)}>{open ? "Ocultar" : "Ver detalle e historial"}</button>
          {canWrite && inv.status === "ACTIVA" ? <button type="button" className="min-h-11 rounded border border-rose-500/50 px-3 text-rose-600" onClick={() => setAsking(true)} data-testid="invoice-annul">Anular</button> : null}
        </div>
      </div>
      {open ? (
        <div className="mt-2 space-y-2">
          <ul>{inv.lines.map((l) => <li key={`${l.deliveryLineId}-${l.quantity}`}>{l.product} {l.orderRef ? `(${l.orderRef})` : ""} — {n(l.quantity)} u. {l.status !== "ACTIVA" ? "(anulada)" : ""}</li>)}</ul>
          {inv.observations ? <p className="text-[var(--os-text-muted)]">Obs.: {inv.observations}</p> : null}
          <ul className="text-xs text-[var(--os-text-muted)]">{inv.history.map((h, i) => <li key={i}>{dateTime(h.at)} · {h.type} · {h.actor}</li>)}</ul>
          {inv.annulReason ? <p className="text-xs">Motivo de anulación: {inv.annulReason}</p> : null}
        </div>
      ) : null}
      {asking ? (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-xs">Motivo de la anulación<input className={`${fieldCls} block w-72`} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="annul-reason" /></label>
          <Button type="button" onClick={() => void annul()} data-testid="annul-confirm">Confirmar anulación</Button>
          <Button type="button" variant="secondary" onClick={() => setAsking(false)}>Cancelar</Button>
        </div>
      ) : null}
    </article>
  );
}
