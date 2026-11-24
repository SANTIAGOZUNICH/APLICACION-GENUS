"use client";

/**
 * Administración › CAJAS GENUS. Stock real calculado en el servidor, historial de ingresos / egresos / ajustes con saldo acumulado, consumo por cliente y
 * período, filtros, Excel, y las acciones autorizadas (stock inicial, ajuste, anulación, clientes con cajas propias, pendientes de revisión).
 * Se actualiza sola (sondeo + evento) sin recargar la aplicación.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadXlsx, exportFileName } from "@/lib/sheet-io";
import type { ClientSettingView, ClientVariantHint, CajasReport, MovementView, PendingView } from "@/lib/cajas-genus/service";
import { KIND_LABEL } from "@/lib/cajas-genus/rules";
import { CAJAS_CHANGED_EVENT, cajasGet, cajasPost, newKey, useCajasSummary } from "./cajas-client";

const nf = new Intl.NumberFormat("es-AR");
const fieldCls = "min-h-11 w-full rounded-lg border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-base";
const cardCls = "rounded-xl border border-[var(--os-border)] p-4";
const dayFmt = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "—");
const dt = (iso: string) => new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
const REVIEW_LABEL: Record<string, string> = {
  SIN_CLIENTE: "Entrega sin cliente identificado",
  SIN_DETALLE: "Entrega sin detalle de cajas",
  CAJAS_NO_ENTERAS: "Cajas no enteras en el detalle",
};
type Tab = "TODOS" | "INGRESO" | "EGRESOS" | "AJUSTES";
const TAB_KINDS: Record<Tab, string[] | null> = { TODOS: null, INGRESO: ["INGRESO"], EGRESOS: ["EGRESO_ENTREGA", "AJUSTE_ENTREGA"], AJUSTES: ["STOCK_INICIAL", "AJUSTE_MANUAL"] };

export function CajasGenusAdminPanel() {
  const { summary, error: sumError, reload } = useCajasSummary({ pollMs: 20_000 });
  const [filters, setFilters] = useState({ from: "", to: "", client: "", period: "dia", voided: false });
  const [tab, setTab] = useState<Tab>("TODOS");
  const [items, setItems] = useState<MovementView[]>([]);
  const [report, setReport] = useState<CajasReport | null>(null);
  const [pending, setPending] = useState<PendingView[]>([]);
  const [clients, setClients] = useState<{ items: ClientSettingView[]; variants: ClientVariantHint[]; known: Array<{ name: string; key: string; usesOwnBoxes: boolean; configured: boolean }> } | null>(null);
  const [audit, setAudit] = useState<Array<{ id: string; action: string; reason: string | null; actorEmail: string; at: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const f = { from: filters.from || undefined, to: filters.to || undefined, client: filters.client || undefined, voided: filters.voided ? "1" : undefined };
      const [m, r, p, c] = await Promise.all([
        cajasGet<{ items: MovementView[] }>({ view: "movements", ...f }),
        cajasGet<{ report: CajasReport }>({ view: "report", ...f, period: filters.period }),
        cajasGet<{ pending: PendingView[] }>({ view: "pending" }),
        cajasGet<{ items: ClientSettingView[]; variants: ClientVariantHint[]; known: never[] }>({ view: "clients" }),
      ]);
      setItems(m.items ?? []);
      setReport(r.report ?? null);
      setPending(p.pending ?? []);
      setClients(c as never);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar.");
    }
  }, [filters]);
  useEffect(() => {
    queueMicrotask(() => void load());
    const t = setInterval(() => document.visibilityState === "visible" && void load(), 20_000);
    const onChange = () => void load();
    window.addEventListener(CAJAS_CHANGED_EVENT, onChange);
    return () => {
      clearInterval(t);
      window.removeEventListener(CAJAS_CHANGED_EVENT, onChange);
    };
  }, [load]);

  async function run(label: string, fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(label);
      await Promise.all([load(), reload()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la acción.");
    } finally {
      setBusy(false);
    }
  }

  const shown = useMemo(() => {
    const kinds = TAB_KINDS[tab];
    return kinds ? items.filter((m) => kinds.includes(m.kind)) : items;
  }, [items, tab]);

  async function exportXlsx() {
    await downloadXlsx(exportFileName("cajas-genus", "xlsx"), "Cajas Genus", ["FECHA", "TIPO", "CLIENTE", "BULTOS", "CANTIDAD", "CAJAS", "SALDO", "REGISTRÓ", "ESTADO", "NOTA"], shown.map((m) => [
      dayFmt(m.fecha), KIND_LABEL[m.kind], m.clientName ?? "", m.bultos == null ? "" : String(m.bultos), m.cantidad == null ? "" : String(m.cantidad), String(m.delta), m.saldo == null ? "" : String(m.saldo), m.createdBy, m.status === "ACTIVO" ? "Activo" : "Anulado", m.note ?? m.voidReason ?? "",
    ]));
  }

  const critical = Boolean(summary?.critical);
  return (
    <section className="space-y-4" data-testid="cajas-admin">
      {error || sumError ? <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm" data-testid="cajas-error">{error ?? sumError}</p> : null}
      {notice ? <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">{notice}</p> : null}

      {critical && summary ? (
        <div role="alert" className="flex items-start gap-3 rounded-xl border-2 border-red-700 bg-red-600 p-4 text-white" data-testid="cajas-alerta">
          <AlertTriangle className="mt-0.5 size-6 shrink-0" aria-hidden />
          <div>
            <p className="text-lg font-bold">STOCK CRÍTICO DE CAJAS GENUS</p>
            <p className="text-sm">Quedan solamente <strong>{nf.format(summary.stock ?? 0)}</strong> cajas disponibles{summary.negative ? " (saldo negativo)" : ""}. Es necesario realizar una reposición.</p>
          </div>
        </div>
      ) : null}
      {summary && !summary.configured ? (
        <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm" data-testid="cajas-sin-inicial">
          Todavía no se configuró el <strong>stock inicial</strong>: hasta entonces no hay stock calculado ni alertas. Las entregas y los ingresos ya se van registrando. Configuralo abajo, en «Stock inicial».
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className={`${cardCls} ${critical ? "border-red-600 bg-red-600/10" : ""}`} data-testid="cajas-stock-actual">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">Stock actual</p>
          <p className={`text-3xl font-bold ${critical ? "text-red-600" : ""}`}>{summary?.stock == null ? "—" : nf.format(summary.stock)}</p>
          <p className="text-xs text-[var(--os-text-muted)]">{summary ? `Alerta si ≤ ${nf.format(summary.threshold)}` : ""}</p>
        </div>
        <div className={cardCls}><p className="text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">Total de ingresos</p><p className="text-2xl font-bold" data-testid="cajas-total-ingresos">{summary ? nf.format(summary.totalIngresos) : "—"}</p></div>
        <div className={cardCls}><p className="text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">Total de egresos</p><p className="text-2xl font-bold" data-testid="cajas-total-egresos">{summary ? nf.format(summary.totalEgresos) : "—"}</p></div>
        <div className={cardCls}><p className="text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">Pendientes de revisión</p><p className="text-2xl font-bold" data-testid="cajas-pendientes">{summary ? summary.pendingReviews : "—"}</p></div>
      </div>

      <div className={`${cardCls} space-y-3`}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <label className="text-sm font-medium">Desde<input type="date" className={fieldCls} value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} data-testid="cajas-f-desde" /></label>
          <label className="text-sm font-medium">Hasta<input type="date" className={fieldCls} value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} data-testid="cajas-f-hasta" /></label>
          <label className="col-span-2 text-sm font-medium md:col-span-1">Cliente<input className={fieldCls} value={filters.client} onChange={(e) => setFilters((f) => ({ ...f, client: e.target.value }))} placeholder="Todos" data-testid="cajas-f-cliente" /></label>
          <label className="text-sm font-medium">Período<select className={fieldCls} value={filters.period} onChange={(e) => setFilters((f) => ({ ...f, period: e.target.value }))} data-testid="cajas-f-periodo"><option value="dia">Diario</option><option value="semana">Semanal</option><option value="mes">Mensual</option></select></label>
          <label className="flex min-h-11 items-end gap-2 pb-2 text-sm"><input type="checkbox" className="size-5" checked={filters.voided} onChange={(e) => setFilters((f) => ({ ...f, voided: e.target.checked }))} /> Ver anulados</label>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["TODOS", "INGRESO", "EGRESOS", "AJUSTES"] as Tab[]).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} aria-pressed={tab === t} className={`min-h-11 rounded-lg border px-4 text-sm font-medium ${tab === t ? "border-[var(--os-teal)] bg-[var(--os-teal)]/15" : "border-[var(--os-border)]"}`} data-testid={`cajas-tipo-${t}`}>
              {{ TODOS: "Todos", INGRESO: "Ingresos", EGRESOS: "Egresos", AJUSTES: "Ajustes de stock" }[t]}
            </button>
          ))}
          <Button type="button" variant="secondary" className="min-h-11" onClick={() => void exportXlsx()} data-testid="cajas-excel"><Download className="mr-1 size-4" /> Excel</Button>
          <Button type="button" variant="secondary" className="min-h-11" onClick={() => void Promise.all([load(), reload()])}><RefreshCw className="mr-1 size-4" /> Actualizar</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={cardCls} data-testid="cajas-por-cliente">
          <h3 className="mb-2 text-sm font-semibold">Consumo de cajas por cliente</h3>
          {report && report.porCliente.length ? (
            <ul className="space-y-1.5 text-sm">
              {report.porCliente.slice(0, 12).map((c) => {
                const max = report.porCliente[0]!.cajas || 1;
                return (
                  <li key={c.cliente}>
                    <div className="flex justify-between gap-2"><span className="truncate">{c.cliente}</span><span className="shrink-0 font-medium">{nf.format(c.cajas)} cajas · {c.entregas} entr.</span></div>
                    <div className="h-2 rounded bg-[var(--os-border)]/40"><div className="h-2 rounded bg-[var(--os-teal)]" style={{ width: `${Math.max(3, (c.cajas / max) * 100)}%` }} /></div>
                  </li>
                );
              })}
            </ul>
          ) : <p className="text-sm text-[var(--os-text-muted)]">Sin egresos en el período.</p>}
        </div>
        <div className={cardCls} data-testid="cajas-por-periodo">
          <h3 className="mb-2 text-sm font-semibold">Ingresos y egresos {filters.period === "dia" ? "diarios" : filters.period === "semana" ? "semanales" : "mensuales"}</h3>
          {report && report.porPeriodo.length ? (
            <ul className="space-y-1.5 text-sm">
              {report.porPeriodo.slice(-14).map((p) => {
                const max = Math.max(1, ...report.porPeriodo.map((x) => Math.max(x.ingresos, x.egresos)));
                return (
                  <li key={p.periodo} className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
                    <span className="text-xs">{dayFmt(p.periodo)}</span>
                    <div className="space-y-0.5">
                      <div className="h-2 rounded bg-emerald-500/80" style={{ width: `${(p.ingresos / max) * 100}%`, minWidth: p.ingresos ? 3 : 0 }} title={`Ingresos ${p.ingresos}`} />
                      <div className="h-2 rounded bg-rose-500/80" style={{ width: `${(p.egresos / max) * 100}%`, minWidth: p.egresos ? 3 : 0 }} title={`Egresos ${p.egresos}`} />
                    </div>
                  </li>
                );
              })}
              <li className="text-xs text-[var(--os-text-muted)]"><span className="text-emerald-600">■</span> ingresos · <span className="text-rose-600">■</span> egresos</li>
            </ul>
          ) : <p className="text-sm text-[var(--os-text-muted)]">Sin movimientos en el período.</p>}
        </div>
      </div>

      <MovementsTable items={shown} busy={busy} onVoid={(id, reason) => void run("Movimiento anulado.", () => cajasPost("void", { id, reason }))} />

      <div className="grid gap-4 lg:grid-cols-2">
        <InitialStockForm busy={busy} summary={summary} onSubmit={(p) => void run("Stock inicial registrado.", () => cajasPost("set_initial", p))} />
        <AdjustForm busy={busy} onSubmit={(p) => void run("Ajuste registrado.", () => cajasPost("adjust", p))} />
      </div>

      <PendingList pending={pending} onReconcile={() => void run("Entregas recalculadas.", () => cajasPost("reconcile", { onlyMissing: true }))} busy={busy} />

      <ClientsSettings
        data={clients}
        busy={busy}
        onSet={(name, usesOwnBoxes) => void run("Cliente actualizado: afecta las entregas futuras.", () => cajasPost("set_client", { name, usesOwnBoxes }))}
        onReclassify={(name) => void run("Entregas del cliente reclasificadas con movimientos auditados.", () => cajasPost("reclassify", { name }))}
      />

      <details className={cardCls} onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open && !audit) void cajasGet<{ audit: never[] }>({ view: "audit" }).then((r) => setAudit(r.audit as never)).catch(() => undefined); }}>
        <summary className="cursor-pointer text-sm font-semibold">Auditoría</summary>
        <ul className="mt-2 max-h-72 space-y-1 overflow-auto text-xs">
          {(audit ?? []).map((a) => <li key={a.id}><strong>{a.action}</strong> · {a.actorEmail} · {dt(a.at)}{a.reason ? ` · ${a.reason}` : ""}</li>)}
          {audit && !audit.length ? <li>Sin registros.</li> : null}
        </ul>
      </details>
    </section>
  );
}

function MovementsTable({ items, busy, onVoid }: { items: MovementView[]; busy: boolean; onVoid: (id: string, reason: string) => void }) {
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  return (
    <div className={`${cardCls} overflow-x-auto`} data-testid="cajas-historial">
      <h3 className="mb-2 text-sm font-semibold">Historial de movimientos y saldo acumulado</h3>
      <table className="w-full min-w-[46rem] text-sm">
        <thead><tr className="text-left text-xs uppercase text-[var(--os-text-muted)]"><th className="py-1">Fecha</th><th>Tipo</th><th>Cliente / detalle</th><th className="text-right">Bultos × cant.</th><th className="text-right">Cajas</th><th className="text-right">Saldo</th><th>Registró</th><th /></tr></thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.id} className={`border-t border-[var(--os-border)] ${m.status !== "ACTIVO" ? "text-[var(--os-text-muted)] line-through" : ""}`} data-testid="cajas-mov" data-kind={m.kind}>
              <td className="py-1.5">{dayFmt(m.fecha)}</td>
              <td>{KIND_LABEL[m.kind]}{m.status !== "ACTIVO" ? " (anulado)" : ""}</td>
              <td className="max-w-[16rem] truncate">{m.clientName ?? m.note ?? "—"}{m.kind === "EGRESO_ENTREGA" && m.delta === 0 ? " · cajas propias" : ""}</td>
              <td className="text-right">{m.bultos != null ? `${m.bultos} × ${m.cantidad}` : "—"}</td>
              <td className={`text-right font-medium ${m.delta < 0 ? "text-rose-600" : m.delta > 0 ? "text-emerald-600" : ""}`}>{m.kind === "STOCK_INICIAL" ? `= ${nf.format(m.delta)}` : `${m.delta > 0 ? "+" : ""}${nf.format(m.delta)}`}</td>
              <td className="text-right">{m.saldo == null ? "—" : nf.format(m.saldo)}</td>
              <td className="truncate text-xs">{m.createdBy}</td>
              <td className="text-right">
                {m.status === "ACTIVO" && (m.kind === "INGRESO" || m.kind === "AJUSTE_MANUAL" || m.kind === "STOCK_INICIAL") ? (
                  voiding === m.id ? (
                    <span className="flex gap-1">
                      <input className="min-h-9 w-40 rounded border border-[var(--os-border)] px-2 text-sm" placeholder="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />
                      <Button type="button" size="sm" disabled={busy || !reason.trim()} onClick={() => { onVoid(m.id, reason.trim()); setVoiding(null); setReason(""); }}>Anular</Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => setVoiding(null)}>No</Button>
                    </span>
                  ) : <button type="button" className="text-xs text-rose-700 underline" onClick={() => { setVoiding(m.id); setReason(""); }}>Anular</button>
                ) : null}
              </td>
            </tr>
          ))}
          {!items.length ? <tr><td colSpan={8} className="py-3 text-center text-[var(--os-text-muted)]">Sin movimientos para los filtros elegidos.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

function InitialStockForm({ busy, summary, onSubmit }: { busy: boolean; summary: { configured: boolean; baseline: number | null } | null; onSubmit: (p: Record<string, unknown>) => void }) {
  const [qty, setQty] = useState("");
  const [fecha, setFecha] = useState(today());
  const [note, setNote] = useState("");
  const [key, setKey] = useState(newKey);
  const [sure, setSure] = useState(false);
  return (
    <div className={`${cardCls} space-y-2`} data-testid="cajas-stock-inicial">
      <h3 className="text-sm font-semibold">Stock inicial</h3>
      <p className="text-xs text-[var(--os-text-muted)]">Conteo físico real de cajas Genus. Desde este movimiento cuentan los ingresos y egresos posteriores. {summary?.configured ? `Vigente: ${nf.format(summary.baseline ?? 0)}.` : "Todavía no configurado."}</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm font-medium">Cajas<input inputMode="numeric" className={fieldCls} value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} data-testid="cajas-inicial-cantidad" /></label>
        <label className="text-sm font-medium">Fecha<input type="date" className={fieldCls} value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
      </div>
      <label className="block text-sm font-medium">Nota<input className={fieldCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: conteo del 24/11" /></label>
      {sure ? (
        <div className="flex gap-2">
          <Button type="button" disabled={busy || qty === ""} className="min-h-11 flex-1" onClick={() => { onSubmit({ quantity: Number(qty), fecha, note, key }); setSure(false); setKey(newKey()); setQty(""); }} data-testid="cajas-inicial-confirmar">Confirmar stock inicial</Button>
          <Button type="button" variant="secondary" className="min-h-11" onClick={() => setSure(false)}>Cancelar</Button>
        </div>
      ) : <Button type="button" variant="secondary" className="min-h-11 w-full" disabled={busy || qty === ""} onClick={() => setSure(true)} data-testid="cajas-inicial-guardar">Establecer stock inicial</Button>}
    </div>
  );
}

function AdjustForm({ busy, onSubmit }: { busy: boolean; onSubmit: (p: Record<string, unknown>) => void }) {
  const [sign, setSign] = useState<1 | -1>(-1);
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(newKey);
  return (
    <div className={`${cardCls} space-y-2`} data-testid="cajas-ajuste">
      <h3 className="text-sm font-semibold">Ajuste de stock</h3>
      <p className="text-xs text-[var(--os-text-muted)]">Corrige diferencias de inventario sin tocar el historial. Motivo obligatorio; queda auditado.</p>
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <div className="flex gap-1">
          <button type="button" aria-pressed={sign === 1} onClick={() => setSign(1)} className={`min-h-11 rounded-lg border px-3 text-sm font-medium ${sign === 1 ? "border-emerald-600 bg-emerald-500/15" : "border-[var(--os-border)]"}`}>Sumar</button>
          <button type="button" aria-pressed={sign === -1} onClick={() => setSign(-1)} className={`min-h-11 rounded-lg border px-3 text-sm font-medium ${sign === -1 ? "border-rose-600 bg-rose-500/15" : "border-[var(--os-border)]"}`}>Restar</button>
        </div>
        <input inputMode="numeric" className={fieldCls} value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} placeholder="Cajas" aria-label="Cajas a ajustar" data-testid="cajas-ajuste-cantidad" />
      </div>
      <input className={fieldCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (obligatorio)" data-testid="cajas-ajuste-motivo" />
      <Button type="button" variant="secondary" className="min-h-11 w-full" disabled={busy || !qty || Number(qty) === 0 || !reason.trim()} onClick={() => { onSubmit({ delta: sign * Number(qty), reason, key }); setQty(""); setReason(""); setKey(newKey()); }} data-testid="cajas-ajuste-guardar">Registrar ajuste</Button>
    </div>
  );
}

function PendingList({ pending, onReconcile, busy }: { pending: PendingView[]; onReconcile: () => void; busy: boolean }) {
  return (
    <div className={`${cardCls} space-y-2`} data-testid="cajas-revision">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Entregas pendientes de revisión ({pending.length})</h3>
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onReconcile}>Recalcular entregas</Button>
      </div>
      <p className="text-xs text-[var(--os-text-muted)]">No se descontó nada de estas entregas: falta el cliente o el detalle de cajas. Se resuelven solas cuando se completa el dato en la entrega (Producción › Entregados › editar).</p>
      {pending.length ? (
        <ul className="space-y-1 text-sm">
          {pending.map((p) => (
            <li key={p.deliveryLineId} className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2" data-testid="cajas-pendiente">
              <strong>{REVIEW_LABEL[p.reason] ?? p.reason}</strong> · {p.client ?? "sin cliente"} · {p.product ?? "—"}{p.orderNumber ? ` · ${p.orderNumber}` : ""}{p.quantity != null ? ` · ${nf.format(p.quantity)} u.` : ""}{p.deliveredAt ? ` · ${dt(p.deliveredAt)}` : ""}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-[var(--os-text-muted)]">No hay entregas pendientes de revisión.</p>}
    </div>
  );
}

function ClientsSettings({ data, busy, onSet, onReclassify }: { data: { items: ClientSettingView[]; variants: ClientVariantHint[]; known: Array<{ name: string; key: string; usesOwnBoxes: boolean; configured: boolean }> } | null; busy: boolean; onSet: (name: string, own: boolean) => void; onReclassify: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <div className={`${cardCls} space-y-3`} data-testid="cajas-clientes">
      <h3 className="text-sm font-semibold">Clientes que usan cajas propias (no descuentan stock de Cajas Genus)</h3>
      <p className="text-xs text-[var(--os-text-muted)]">Cualquier otro cliente usa cajas Genus por defecto. Cambiar un cliente afecta las entregas futuras; para reflejarlo en las ya registradas usá «Reclasificar» (queda auditado).</p>
      <ul className="divide-y divide-[var(--os-border)] text-sm">
        {(data?.items ?? []).map((c) => (
          <li key={c.clientKey} className="flex flex-wrap items-center justify-between gap-2 py-1.5" data-testid="cajas-cliente">
            <span><strong>{c.displayName}</strong> <span className="text-xs text-[var(--os-text-muted)]">{c.portalClientId ? "· vinculado al maestro" : "· sin vínculo al maestro"}</span></span>
            <span className="flex gap-1">
              <button type="button" disabled={busy} onClick={() => onSet(c.displayName, !c.usesOwnBoxes)} className={`min-h-11 rounded-lg border px-3 text-sm font-semibold ${c.usesOwnBoxes ? "border-emerald-600 bg-emerald-500/15" : "border-[var(--os-border)]"}`} aria-label={`Utiliza cajas propias: ${c.usesOwnBoxes ? "SI" : "NO"}`}>{c.usesOwnBoxes ? "SI" : "NO"}</button>
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => onReclassify(c.displayName)}>Reclasificar</Button>
            </span>
          </li>
        ))}
      </ul>
      {data?.variants.length ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-sm" data-testid="cajas-variantes">
          <p className="font-medium">Posibles variantes (revisar, NO se aplican solas):</p>
          <ul className="mt-1 space-y-1">
            {data.variants.map((v) => (
              <li key={v.key} className="flex flex-wrap items-center justify-between gap-2"><span>«{v.name}» se parece a {v.similarTo}</span><Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => onSet(v.name, true)}>Es el mismo: cajas propias</Button></li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <input className={`${fieldCls} flex-1`} list="cajas-clientes-conocidos" value={name} onChange={(e) => setName(e.target.value)} placeholder="Agregar un cliente (nombre)" data-testid="cajas-cliente-nombre" />
        <datalist id="cajas-clientes-conocidos">{(data?.known ?? []).map((k) => <option key={k.key} value={k.name} />)}</datalist>
        <Button type="button" variant="secondary" className="min-h-11" disabled={busy || !name.trim()} onClick={() => { onSet(name.trim(), true); setName(""); }} data-testid="cajas-cliente-agregar">Marcar con cajas propias</Button>
      </div>
    </div>
  );
}
