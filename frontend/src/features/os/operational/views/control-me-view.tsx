"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { actorHeaders, fmtDate, fmtNum, ME_CONTROL_FOCUS_EVENT, meApi, takeFocus, type MeControlFocus } from "@/features/os/me-control/me-control-client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { WeekReport, ConfigView } from "@/lib/me-control/service";
import type { JobState, LineState } from "@/lib/me-control/compute";

const REFRESH_MS = 20_000;
const ROLES = ["ENVASE", "CIERRE", "DISPENSADOR", "ETIQUETA", "ESTUCHE", "PRECINTO", "OTRO"] as const;
const ROLE_LABEL: Record<string, string> = { ENVASE: "Envase", CIERRE: "Tapa / cierre", DISPENSADOR: "Dispensador", ETIQUETA: "Etiqueta", ESTUCHE: "Estuche", PRECINTO: "Precinto", OTRO: "Otro" };

const todayIso = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

const STATE_STYLE: Record<JobState, string> = {
  COMPLETO: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  STOCK_INSUFICIENTE: "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100",
  MATERIAL_SIN_IDENTIFICAR: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  PENDIENTE_CONFIRMACION: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
};
const LINE_LABEL: Record<LineState, string> = { OK: "Completo", FALTANTE: "Stock insuficiente", SIN_IDENTIFICAR: "Material sin identificar", PENDIENTE_CONFIRMACION: "Pendiente de confirmación" };

type Job = WeekReport["jobs"][number];
type MaterialHit = { codigo: string; descripcion: string; cliente: string; role: string; stock: number };

/**
 * Depósito → Control de ME: para cada trabajo de Envasado de la semana, qué materiales de empaque necesita, cuánto hay y
 * cuánto falta. Depósito confirma o corrige las asociaciones de materiales; NO modifica la planificación ni asigna pedidos.
 */
export function ControlMeView() {
  const { email, sectorId } = usePreviewSession();
  const canManage = String(sectorId).toUpperCase() === "DEPOSITO";
  const headers = useMemo(() => actorHeaders(email, sectorId), [email, sectorId]);
  const [week, setWeek] = useState(todayIso());
  const [report, setReport] = useState<WeekReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocusState] = useState<MeControlFocus | null>(null);
  const [panel, setPanel] = useState<{ client: string; product: string; role?: string } | null>(null);

  const load = useCallback(
    async (silent = false) => {
      try {
        const body = await meApi<WeekReport>(`?week=${week}`, headers);
        setReport(body);
        setError(null);
      } catch (e) {
        if (!silent) setError(e instanceof Error ? e.message : "Error");
      }
    },
    [headers, week]
  );

  useEffect(() => {
    const f = takeFocus();
    if (f) {
      setFocusState(f);
      setWeek(f.week);
    }
    const onFocus = (e: Event) => {
      const d = (e as CustomEvent<MeControlFocus>).detail;
      setFocusState(d);
      setWeek(d.week);
    };
    window.addEventListener(ME_CONTROL_FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(ME_CONTROL_FOCUS_EVENT, onFocus);
  }, []);

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

  const changed = () => {
    void load(true);
    window.dispatchEvent(new CustomEvent("genus:me-control-changed"));
  };

  const jobs = report?.jobs ?? [];
  return (
    <TwinShell title="Control de ME">
      <header className="mb-4">
        <h2 className="text-2xl font-semibold tracking-tight">Control de ME</h2>
        <p className="text-sm text-[var(--os-text-muted)]">Materiales de empaque que necesitan los trabajos de Envasado programados · no modifica la planificación ni el stock</p>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="me-week-picker">
        <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={() => setWeek(addDays(report?.weekStart ?? week, -7))} aria-label="Semana anterior" data-testid="me-week-prev">←</button>
        <label className="flex items-center gap-2 text-sm">
          Semana del
          <input type="date" className="rounded border px-2 py-1 text-sm" value={report?.weekStart ?? week} onChange={(e) => e.target.value && setWeek(e.target.value)} data-testid="me-week-input" />
        </label>
        <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={() => setWeek(addDays(report?.weekStart ?? week, 7))} aria-label="Semana siguiente" data-testid="me-week-next">→</button>
        <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={() => setWeek(todayIso())}>Esta semana</button>
        {report ? <span className="text-xs text-[var(--os-text-muted)]">{fmtDate(report.weekStart)} – {fmtDate(report.weekEnd)}</span> : null}
      </div>

      {error ? <p className="mb-3 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900" role="alert">{error}</p> : null}
      {report?.schemaPending ? <p className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">El Control de ME todavía no está disponible en esta base de datos (migración pendiente).</p> : null}
      {!report ? <p className="text-sm text-[var(--os-text-muted)]">Cargando…</p> : null}
      {report && jobs.length === 0 && !report.schemaPending ? <p className="text-sm text-[var(--os-text-muted)]" data-testid="me-empty">No hay trabajos de Envasado programados en esta semana.</p> : null}

      {jobs.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="os-table w-full text-left text-sm" data-testid="me-table">
            <thead className="text-xs uppercase text-[var(--os-text-muted)]">
              <tr>
                <th className="p-2">Cliente</th>
                <th className="p-2">Producto</th>
                <th className="p-2 text-right">Cantidad programada</th>
                <th className="p-2">Material requerido</th>
                <th className="p-2 text-right">Cantidad necesaria</th>
                <th className="p-2 text-right">Stock disponible</th>
                <th className="p-2 text-right">Faltante</th>
                <th className="p-2">Estado</th>
              </tr>
            </thead>
            {jobs.map((j) => {
              const isFocus = focus && focus.client === j.job.client && focus.product === j.job.product;
              return <JobRows key={j.job.id} j={j} highlight={Boolean(isFocus)} canManage={canManage} onOpen={(role) => setPanel({ client: j.job.client, product: j.job.product, role })} />;
            })}
          </table>
        </div>
      ) : null}

      {panel ? <ConfigPanel key={`${panel.client}|${panel.product}`} {...panel} headers={headers} canManage={canManage} onClose={() => setPanel(null)} onChanged={changed} /> : null}
    </TwinShell>
  );
}

function JobRows({ j, highlight, canManage, onOpen }: { j: Job; highlight: boolean; canManage: boolean; onOpen: (role?: string) => void }) {
  const rows = j.lines.length ? j.lines : [null];
  return (
    <tbody className={`border-t-2 border-[var(--os-border)] ${highlight ? "bg-rose-50/60 dark:bg-rose-950/20" : ""}`} data-testid="me-job" data-job-state={j.state}>
      {rows.map((l, i) => (
        <tr key={l?.rowId ?? `${l?.role ?? "x"}-${i}`} className="align-top" data-testid="me-line" data-line-state={l?.state ?? "SIN_ASOCIACION"}>
          {i === 0 ? (
            <>
              <td className="p-2 font-medium" rowSpan={rows.length}>{j.job.client}</td>
              <td className="p-2" rowSpan={rows.length}>
                {j.job.product}
                <div className="mt-1 text-xs text-[var(--os-text-muted)]">{j.job.sector === "ENVASADO_MASIVO" ? "Envasado Masivo" : "Envasado Premium"}{j.job.date ? ` · ${fmtDate(j.job.date)}` : ""}</div>
                <span className={`mt-1 inline-block rounded px-2 py-0.5 text-xs font-semibold ${STATE_STYLE[j.state]}`} data-testid="me-job-state">{j.stateLabel}</span>
                {canManage ? <div><button type="button" className="mt-1 text-xs font-semibold underline" onClick={() => onOpen()} data-testid="me-config-open">Materiales del producto</button></div> : null}
              </td>
              <td className="p-2 text-right tabular-nums" rowSpan={rows.length}>{j.qtyIssue ? <span title="La cantidad no está en unidades">sin definir</span> : fmtNum(j.job.qty)}</td>
            </>
          ) : null}
          {l ? (
            <>
              <td className="p-2">
                {l.materialLabel}
                <div className="text-xs text-[var(--os-text-muted)]">{l.roleLabel}{l.confirmation === "SUGERIDO" ? " · sugerido por IA / sin confirmar" : ""}{l.confirmation === "PENDIENTE" ? " · pendiente de identificar" : ""}</div>
                {l.confirmation !== "CONFIRMADO" && canManage ? <button type="button" className="text-xs font-semibold underline" onClick={() => onOpen(l.role)}>{l.confirmation === "SUGERIDO" ? "Confirmar o corregir" : "Identificar"}</button> : null}
              </td>
              <td className="p-2 text-right tabular-nums">{fmtNum(l.needed)}{l.state === "SIN_IDENTIFICAR" ? <span className="block text-xs text-[var(--os-text-muted)]">estimada</span> : null}</td>
              <td className="p-2 text-right tabular-nums">{l.stock == null ? "—" : fmtNum(l.stock)}</td>
              <td className={`p-2 text-right tabular-nums ${l.faltante > 0 ? "font-bold text-rose-700 dark:text-rose-300" : ""}`}>{l.state === "SIN_IDENTIFICAR" ? "—" : fmtNum(l.faltante)}</td>
              <td className="p-2 text-xs">{LINE_LABEL[l.state]}</td>
            </>
          ) : (
            <td className="p-2 text-amber-800 dark:text-amber-200" colSpan={5}>
              REVISAR: este producto no tiene materiales de empaque asociados.
              {canManage ? <button type="button" className="ml-2 text-xs font-semibold underline" onClick={() => onOpen()} data-testid="me-config-open-empty">Asociar materiales</button> : null}
            </td>
          )}
        </tr>
      ))}
    </tbody>
  );
}

function ConfigPanel({ client, product, role, headers, canManage, onClose, onChanged }: { client: string; product: string; role?: string; headers: HeadersInit; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const [cfg, setCfg] = useState<ConfigView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<MaterialHit[]>([]);
  const [target, setTarget] = useState<{ mode: "add" | "replace"; rowId?: string; role?: string } | null>(role ? { mode: "add", role } : null);
  const [qty, setQty] = useState("1");
  const [addRole, setAddRole] = useState<string>(role ?? "");

  const path = `/products?client=${encodeURIComponent(client)}&product=${encodeURIComponent(product)}`;
  const reload = useCallback(async () => {
    try {
      setCfg(await meApi<ConfigView>(path, headers));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }, [path, headers]);
  useEffect(() => {
    const t = setTimeout(() => void reload(), 0);
    return () => clearTimeout(t);
  }, [reload]);

  useEffect(() => {
    if (!target) return;
    const t = setTimeout(async () => {
      try {
        const r = await meApi<{ items: MaterialHit[] }>(`/materials?q=${encodeURIComponent(q)}`, headers);
        setHits(r.items);
      } catch {
        setHits([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, target, headers]);

  const act = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (okMsg) setNote(okMsg);
      await reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  };
  const patch = (id: string, body: unknown, msg?: string) => act(() => meApi(`/products/${id}`, headers, { method: "PATCH", body }), msg);

  const pick = (hit: MaterialHit) => {
    if (!target) return;
    void act(async () => {
      if (target.mode === "replace" && target.rowId) await meApi(`/products/${target.rowId}`, headers, { method: "PATCH", body: { action: "replace", materialCodigo: hit.codigo } });
      else await meApi("/products", headers, { method: "POST", body: { client, product, materialCodigo: hit.codigo, role: addRole || target.role || hit.role, qtyPerUnit: qty } });
      setTarget(null);
      setQ("");
    }, `Material ${hit.codigo} confirmado para este producto.`);
  };

  const statusLabel = (r: ConfigView["rows"][number]) => (r.status === "CONFIRMADO" ? "Confirmado" : r.status === "SUGERIDO" ? (r.source === "IA" ? "Sugerido por IA" : r.source === "COMPATIBILIDAD" ? "Compatibilidad registrada (sin confirmar)" : "Sugerido por el inventario") : r.status === "PENDIENTE" ? "Pendiente de identificación" : "Rechazado");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" data-testid="me-config-panel">
        <DialogHeader>
          <DialogTitle>Materiales de empaque — {client} / {product}</DialogTitle>
          <DialogDescription>Lo confirmado acá se recuerda para los próximos trabajos de este producto. No modifica fórmulas, pedidos ni stock.</DialogDescription>
        </DialogHeader>
        {error ? <p className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900" role="alert">{error}</p> : null}
        {note ? <p className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" role="status">{note}</p> : null}

        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-[var(--os-text-muted)]"><tr><th className="p-1">Material</th><th className="p-1">Cant. por unidad</th><th className="p-1">Estado</th><th className="p-1" /></tr></thead>
          <tbody>
            {(cfg?.rows ?? []).length === 0 ? <tr><td colSpan={4} className="p-2 text-[var(--os-text-muted)]">Todavía no hay materiales asociados a este producto.</td></tr> : null}
            {(cfg?.rows ?? []).map((r) => (
              <tr key={r.id} className="border-t border-[var(--os-border)] align-top" data-testid="me-config-row" data-status={r.status}>
                <td className="p-1">
                  {r.materialCodigo ? r.materialLabel : <em>{ROLE_LABEL[r.role]} sin identificar</em>}
                  <div className="text-xs text-[var(--os-text-muted)]">{ROLE_LABEL[r.role]}{r.reason ? ` · ${r.reason}` : ""}{r.materialCodigo ? ` · stock ${r.stockKnown ? fmtNum(r.stock) : "sin datos"}` : ""}</div>
                </td>
                <td className="p-1">
                  <input className="w-20 rounded border px-1 py-0.5 text-right" defaultValue={String(r.qtyPerUnit)} disabled={!canManage || busy} aria-label="Cantidad por unidad"
                    onBlur={(e) => e.target.value !== String(r.qtyPerUnit) && void patch(r.id, { action: "update", qtyPerUnit: e.target.value })} />
                </td>
                <td className="p-1 text-xs">{statusLabel(r)}</td>
                <td className="p-1 text-right whitespace-nowrap">
                  {canManage ? (
                    <>
                      {r.status === "SUGERIDO" ? <button type="button" className="mr-2 rounded bg-emerald-700 px-2 py-0.5 text-xs font-semibold text-white" disabled={busy} onClick={() => void patch(r.id, { action: "confirm" }, "Material confirmado.")} data-testid="me-confirm">Confirmar</button> : null}
                      {r.status === "SUGERIDO" ? <button type="button" className="mr-2 text-xs underline" disabled={busy} onClick={() => void patch(r.id, { action: "reject" }, "Sugerencia rechazada: no volverá a proponerse.")} data-testid="me-reject">Rechazar</button> : null}
                      <button type="button" className="mr-2 text-xs underline" disabled={busy} onClick={() => { setTarget({ mode: "replace", rowId: r.id }); setQ(""); }} data-testid="me-replace">{r.materialCodigo ? "Reemplazar" : "Identificar"}</button>
                      <button type="button" className="text-xs text-rose-700 underline" disabled={busy} onClick={() => void act(() => meApi(`/products/${r.id}`, headers, { method: "DELETE" }), "Material quitado del producto.")} data-testid="me-remove">Quitar</button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {canManage ? (
          <div className="mt-3 space-y-2 rounded border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="rounded bg-[var(--os-navy,#071925)] px-3 py-1.5 text-sm font-semibold text-white" onClick={() => { setTarget({ mode: "add" }); setQ(""); }} data-testid="me-add">Agregar material</button>
              <button type="button" className="rounded border px-3 py-1.5 text-sm" disabled={busy} data-testid="me-suggest"
                onClick={() => void act(async () => { const r = await meApi<{ asked: number; suggestions: number }>("/suggest", headers, { method: "POST", body: { client, product } }); setNote(r.asked ? (r.suggestions ? `La IA propuso ${r.suggestions} material(es). Revisalos y confirmalos.` : "La IA no encontró accesorios compatibles seguros.") : "No hay accesorios pendientes para consultar."); })}>
                Sugerir con IA
              </button>
            </div>
            {target ? (
              <div data-testid="me-search-box">
                <p className="text-sm font-semibold">{target.mode === "replace" ? "Buscar el material que corresponde" : "Buscar en todo el inventario de ME"}</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <input className="min-w-[14rem] flex-1 rounded border px-2 py-1 text-sm" placeholder="Código, descripción o cliente…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus data-testid="me-search" />
                  {target.mode === "add" ? (
                    <>
                      <select className="rounded border px-2 py-1 text-sm" value={addRole} onChange={(e) => setAddRole(e.target.value)} aria-label="Tipo de material">
                        <option value="">Tipo: automático</option>
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                      <input className="w-24 rounded border px-2 py-1 text-right text-sm" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Cantidad por unidad" />
                    </>
                  ) : null}
                  <button type="button" className="text-sm underline" onClick={() => setTarget(null)}>Cancelar</button>
                </div>
                <ul className="mt-2 max-h-48 overflow-y-auto" data-testid="me-hits">
                  {hits.map((h) => (
                    <li key={h.codigo}>
                      <button type="button" className="flex w-full items-center justify-between gap-3 rounded px-2 py-1 text-left text-sm hover:bg-[var(--os-surface-hover,#00000010)]" disabled={busy} onClick={() => pick(h)} data-testid="me-hit">
                        <span>{h.codigo} — {h.descripcion}<span className="block text-xs text-[var(--os-text-muted)]">{ROLE_LABEL[h.role]}{h.cliente ? ` · ${h.cliente}` : ""}</span></span>
                        <span className="text-xs tabular-nums">stock {fmtNum(h.stock)}</span>
                      </button>
                    </li>
                  ))}
                  {hits.length === 0 ? <li className="px-2 py-1 text-sm text-[var(--os-text-muted)]">Sin resultados.</li> : null}
                </ul>
              </div>
            ) : null}
          </div>
        ) : <p className="mt-2 text-sm text-[var(--os-text-muted)]">Solo Depósito puede confirmar o corregir los materiales de un producto.</p>}
      </DialogContent>
    </Dialog>
  );
}
