"use client";

/** Administración › INSUMOS › INGRESOS (alta, corrección y anulación auditadas) y HISTORIAL DE MOVIMIENTOS del libro de stock. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { downloadXlsx, exportFileName } from "@/lib/sheet-io";
import { STOCK_KINDS, STOCK_KIND_LABEL } from "@/lib/insumos/stock-rules";
import { SECTOR_LABELS, type SectorId } from "@/types/operational/sector";
import { INSUMOS_CHANGED_EVENT, newStockKey, stockGet, stockPost, type MovementView, type StockAuditView, type StockRowView, type StockSummaryView } from "./insumos-stock-client";
import { field, fmtN, todayAr } from "./insumos-stock-panel";

const th = "px-2 py-2 text-left text-xs font-semibold uppercase text-[var(--os-text-muted)]";
const td = "px-2 py-2 align-top text-sm";
const fmtDay = (d: string) => d.split("-").reverse().join("/");
const fmtWhen = (iso: string) => new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

/** Movimientos del libro con sondeo (20 s, pestaña visible) + evento local tras cada acción. */
function useMovements(filters: { insumoId?: string; kind?: string; from?: string; to?: string }) {
  const [state, setState] = useState<{ items: MovementView[]; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const { insumoId, kind, from, to } = filters;
  const load = useCallback(async () => {
    const n = ++seq.current;
    try {
      const r = await stockGet<{ items: MovementView[]; truncated: boolean }>({ view: "movements", insumoId, kind, from, to });
      if (n === seq.current) {
        setState(r);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError(e instanceof Error ? e.message : "No se pudo cargar el historial.");
    }
  }, [insumoId, kind, from, to]);
  useEffect(() => {
    const t0 = setTimeout(() => void load(), 0);
    const t = setInterval(() => document.visibilityState === "visible" && void load(), 20_000);
    const on = () => void load();
    window.addEventListener(INSUMOS_CHANGED_EVENT, on);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
      window.removeEventListener(INSUMOS_CHANGED_EVENT, on);
    };
  }, [load]);
  return { state, error, reload: load };
}

const sign = (n: number) => (n > 0 ? `+${fmtN(n)}` : fmtN(n));

// ───────────────────────── INGRESOS ─────────────────────────

export function InsumosIngresosPanel({ summary, preselect, onChanged }: { summary: StockSummaryView | null; preselect: string | null; onChanged: () => void }) {
  const { state, error } = useMovements({ kind: "INGRESO" });
  const [dialog, setDialog] = useState<{ insumoId: string | null } | null>(preselect ? { insumoId: preselect } : null);
  const [edit, setEdit] = useState<{ m: MovementView; mode: "corregir" | "anular" | "auditoria" } | null>(null);
  const active = (summary?.items ?? []).filter((r) => r.active);
  return (
    <div className="space-y-3" data-testid="insumos-ingresos">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">Ingresos de insumos</h3>
        <Button className="min-h-11" onClick={() => setDialog({ insumoId: null })} disabled={active.length === 0} data-testid="ingresos-nuevo">Ingresar insumos</Button>
      </div>
      {error ? <p role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{error}</p> : null}
      <div className="overflow-x-auto rounded-xl border border-[var(--os-border)]">
        <table className="w-full min-w-[44rem] text-left" data-testid="ingresos-historial">
          <thead><tr><th className={th}>Fecha</th><th className={th}>Insumo</th><th className={th}>Cantidad</th><th className={th}>Observaciones</th><th className={th}>Registró</th><th className={th}>Estado</th><th className={th}>Acciones</th></tr></thead>
          <tbody className="divide-y divide-[var(--os-border)]">
            {(state?.items ?? []).map((m) => (
              <tr key={m.id} className={m.status === "ANULADO" ? "opacity-60" : ""} data-testid={`ingreso-${m.id}`} data-status={m.status}>
                <td className={`${td} whitespace-nowrap`}>{fmtDay(m.occurredOn)}</td>
                <td className={td}>{m.insumoName}</td>
                <td className={`${td} tabular-nums`}>{fmtN(m.delta)} {m.unit}</td>
                <td className={td}>{m.note ?? ""}</td>
                <td className={td}>{m.createdByName || m.createdBy}</td>
                <td className={td}>{m.status === "ANULADO" ? <span className="rounded bg-rose-500/15 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:text-rose-300" title={m.voidReason ?? ""}>ANULADO</span> : "Activo"}</td>
                <td className={td}>
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="secondary" className="min-h-11" onClick={() => setEdit({ m, mode: "auditoria" })}>Historial</Button>
                    {m.status === "ACTIVO" ? <Button size="sm" variant="secondary" className="min-h-11" onClick={() => setEdit({ m, mode: "corregir" })} data-testid="ingreso-corregir">Corregir</Button> : null}
                    {m.status === "ACTIVO" ? <Button size="sm" variant="secondary" className="min-h-11" onClick={() => setEdit({ m, mode: "anular" })} data-testid="ingreso-anular">Anular</Button> : null}
                  </div>
                </td>
              </tr>
            ))}
            {state && state.items.length === 0 ? <tr><td className={td} colSpan={7}>Todavía no hay ingresos registrados.</td></tr> : null}
          </tbody>
        </table>
      </div>
      {dialog ? <IngresoDialog rows={active} initial={dialog.insumoId} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onChanged(); }} /> : null}
      {edit?.mode === "corregir" ? <CorregirIngresoDialog m={edit.m} onClose={() => setEdit(null)} onDone={() => { setEdit(null); onChanged(); }} /> : null}
      {edit?.mode === "anular" ? <AnularMovDialog m={edit.m} onClose={() => setEdit(null)} onDone={() => { setEdit(null); onChanged(); }} /> : null}
      {edit?.mode === "auditoria" ? <AuditoriaDialog m={edit.m} onClose={() => setEdit(null)} /> : null}
    </div>
  );
}

function IngresoDialog({ rows, initial, onClose, onDone }: { rows: StockRowView[]; initial: string | null; onClose: () => void; onDone: () => void }) {
  const key = useRef(newStockKey()); // una clave por apertura: doble toque / reintento no duplican
  const [fecha, setFecha] = useState(todayAr());
  const [insumoId, setInsumoId] = useState(initial ?? "");
  const [qty, setQty] = useState("");
  const [obs, setObs] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const row = rows.find((r) => r.insumoId === insumoId) ?? null;
  const n = Number(qty);
  const valid = Boolean(row) && qty.trim() !== "" && Number.isInteger(n) && n > 0;
  const next = row?.configured && valid ? (row.stock ?? 0) + n : null;
  async function go() {
    if (busy || !valid) return;
    setBusy(true);
    setErr(null);
    try {
      await stockPost("ingreso", { insumoId, cantidad: n, fecha, observaciones: obs, key: key.current });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo registrar el ingreso.");
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92dvh] w-[min(30rem,calc(100vw-24px))] overflow-y-auto" data-testid="ingreso-dialogo">
        <DialogTitle>Ingresar insumos</DialogTitle>
        <DialogDescription>Registrá lo que entra al depósito de insumos. Vas a ver el stock resultante antes de confirmar.</DialogDescription>
        <label className="text-sm">Fecha<input type="date" className={field} value={fecha} onChange={(e) => setFecha(e.target.value)} data-testid="ingreso-fecha" /></label>
        <label className="text-sm">Insumo
          <select className={field} value={insumoId} onChange={(e) => setInsumoId(e.target.value)} data-testid="ingreso-insumo">
            <option value="">Elegí un insumo…</option>
            {rows.map((r) => <option key={r.insumoId} value={r.insumoId}>{r.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Cantidad{row ? ` (${row.unit})` : ""}<input type="number" inputMode="numeric" min={1} step={1} className={field} value={qty} onChange={(e) => setQty(e.target.value)} data-testid="ingreso-cantidad" /></label>
        <label className="text-sm">Observaciones (opcional)<input className={field} value={obs} onChange={(e) => setObs(e.target.value)} maxLength={500} data-testid="ingreso-observaciones" /></label>
        {row ? (
          <p className="rounded-lg border border-[var(--os-border)] p-3 text-sm" data-testid="ingreso-resumen">
            {row.configured ? (
              <>Stock actual <strong>{fmtN(row.stock ?? 0)}</strong> {row.unit}{next != null ? <> → nuevo stock <strong data-testid="ingreso-nuevo-stock">{fmtN(next)}</strong> {row.unit}</> : null}</>
            ) : (
              <>Este insumo todavía no tiene stock inicial: el ingreso se registra, pero el stock se calcula desde el conteo inicial.</>
            )}
          </p>
        ) : null}
        {err ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{err}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" className="min-h-11" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button className="min-h-11" disabled={busy || !valid} onClick={() => void go()} data-testid="ingreso-confirmar">{busy ? "Registrando…" : "Confirmar ingreso"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CorregirIngresoDialog({ m, onClose, onDone }: { m: MovementView; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState(String(m.delta));
  const [fecha, setFecha] = useState(m.occurredOn);
  const [obs, setObs] = useState(m.note ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await stockPost("corregir_ingreso", { id: m.id, cantidad: Number(qty), fecha, observaciones: obs, reason });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo corregir.");
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92dvh] w-[min(30rem,calc(100vw-24px))] overflow-y-auto" data-testid="ingreso-dialogo-corregir">
        <DialogTitle>Corregir ingreso — {m.insumoName}</DialogTitle>
        <DialogDescription>El insumo no se cambia (si te equivocaste de insumo, anulá y cargá de nuevo). El cambio queda auditado.</DialogDescription>
        <label className="text-sm">Fecha<input type="date" className={field} value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
        <label className="text-sm">Cantidad ({m.unit})<input type="number" inputMode="numeric" min={1} step={1} className={field} value={qty} onChange={(e) => setQty(e.target.value)} data-testid="corregir-ingreso-cantidad" /></label>
        <label className="text-sm">Observaciones<input className={field} value={obs} onChange={(e) => setObs(e.target.value)} maxLength={500} /></label>
        <label className="text-sm">Motivo (obligatorio)<textarea className={`${field} min-h-16 py-2`} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="corregir-ingreso-motivo" /></label>
        {err ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{err}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" className="min-h-11" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button className="min-h-11" disabled={busy || reason.trim().length < 3 || !(Number(qty) > 0)} onClick={() => void go()} data-testid="corregir-ingreso-guardar">{busy ? "Guardando…" : "Guardar corrección"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AnularMovDialog({ m, onClose, onDone }: { m: MovementView; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await stockPost("anular", { id: m.id, reason });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo anular.");
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="w-[min(30rem,calc(100vw-24px))]" data-testid="ingreso-dialogo-anular">
        <DialogTitle>Anular ingreso</DialogTitle>
        <DialogDescription>{fmtDay(m.occurredOn)} · {m.insumoName} · {fmtN(m.delta)} {m.unit}. No se borra: queda marcado como anulado y deja de sumar al stock.</DialogDescription>
        <label className="text-sm">Motivo (obligatorio)<textarea className={`${field} min-h-20 py-2`} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="anular-ingreso-motivo" /></label>
        {err ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{err}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" className="min-h-11" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button className="min-h-11" disabled={busy || reason.trim().length < 3} onClick={() => void go()} data-testid="anular-ingreso-confirmar">{busy ? "Anulando…" : "Anular ingreso"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AuditoriaDialog({ m, onClose }: { m: MovementView; onClose: () => void }) {
  const [events, setEvents] = useState<StockAuditView[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    stockGet<{ events: StockAuditView[] }>({ view: "audit", targetId: m.id }).then((r) => alive && setEvents(r.events)).catch((e) => alive && setErr(e instanceof Error ? e.message : "No se pudo cargar."));
    return () => {
      alive = false;
    };
  }, [m.id]);
  const label: Record<string, string> = { INGRESO_REGISTRADO: "Registrado", INGRESO_CORREGIDO: "Corregido", MOVIMIENTO_ANULADO: "Anulado", AJUSTE_MANUAL: "Ajuste", STOCK_INICIAL: "Stock inicial" };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] w-[min(34rem,calc(100vw-24px))] overflow-y-auto" data-testid="ingreso-dialogo-auditoria">
        <DialogTitle>Historial del movimiento</DialogTitle>
        <DialogDescription>Eventos inmutables: quién, cuándo, motivo y qué cambió.</DialogDescription>
        {err ? <p role="alert" className="text-sm text-rose-700">{err}</p> : null}
        {!events && !err ? <p className="text-sm text-[var(--os-text-muted)]">Cargando…</p> : null}
        <ol className="space-y-2">
          {[...(events ?? [])].reverse().map((e) => (
            <li key={e.id} className="rounded-lg border border-[var(--os-border)] p-3 text-sm" data-testid="evento-stock">
              <p className="font-semibold">{label[e.action] ?? e.action} · {fmtWhen(e.createdAt)}</p>
              <p className="text-[var(--os-text-muted)]">{e.actorName ?? e.actorEmail}{e.reason ? ` · Motivo: ${e.reason}` : ""}</p>
              {e.before ? <p>Antes: {JSON.stringify(e.before)}</p> : null}
              {e.after ? <p>Después: {JSON.stringify(e.after)}</p> : null}
            </li>
          ))}
        </ol>
        <div className="flex justify-end"><Button variant="secondary" className="min-h-11" onClick={onClose}>Cerrar</Button></div>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── HISTORIAL DE MOVIMIENTOS ─────────────────────────

export function InsumosMovimientosPanel({ summary }: { summary: StockSummaryView | null }) {
  const [f, setF] = useState<{ insumoId: string; kind: string; from: string; to: string }>({ insumoId: "", kind: "", from: "", to: "" });
  const { state, error } = useMovements({ insumoId: f.insumoId || undefined, kind: f.kind || undefined, from: f.from || undefined, to: f.to || undefined });
  const items = useMemo(() => state?.items ?? [], [state]);
  const detail = (m: MovementView) => (m.retiroId ? `Retiro de ${SECTOR_LABELS[m.retiroSector as SectorId] ?? m.retiroSector ?? ""} · ${m.retiroResponsable ?? ""}` : (m.note ?? ""));
  async function exportXlsx() {
    await downloadXlsx(exportFileName("movimientos-insumos", "xlsx"), "Movimientos", ["FECHA", "INSUMO", "TIPO", "CANTIDAD", "SALDO", "UNIDAD", "DETALLE", "REGISTRÓ", "ESTADO"], items.map((m) => [fmtDay(m.occurredOn), m.insumoName, STOCK_KIND_LABEL[m.kind], String(m.delta), m.balance == null ? "" : String(m.balance), m.unit, detail(m), m.createdByName || m.createdBy, m.status]));
  }
  return (
    <div className="space-y-3" data-testid="insumos-movimientos">
      <h3 className="text-lg font-semibold">Historial de movimientos</h3>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs">Insumo<select className={field} value={f.insumoId} onChange={(e) => setF({ ...f, insumoId: e.target.value })} data-testid="mov-filtro-insumo"><option value="">Todos</option>{(summary?.items ?? []).map((r) => <option key={r.insumoId} value={r.insumoId}>{r.name}</option>)}</select></label>
        <label className="text-xs">Tipo<select className={field} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} data-testid="mov-filtro-tipo"><option value="">Todos</option>{STOCK_KINDS.map((k) => <option key={k} value={k}>{STOCK_KIND_LABEL[k]}</option>)}</select></label>
        <label className="text-xs">Desde<input type="date" className={field} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label className="text-xs">Hasta<input type="date" className={field} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        <div className="flex items-end"><Button className="min-h-11 w-full" variant="secondary" onClick={() => void exportXlsx()} disabled={items.length === 0}>Exportar a Excel</Button></div>
      </div>
      {error ? <p role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{error}</p> : null}
      {state?.truncated ? <p className="text-xs text-amber-700 dark:text-amber-300">Se muestran los últimos 1000 movimientos: acotá el período para ver el resto.</p> : null}
      <div className="overflow-x-auto rounded-xl border border-[var(--os-border)]">
        <table className="w-full min-w-[52rem] text-left" data-testid="movimientos-tabla">
          <thead><tr><th className={th}>Fecha</th><th className={th}>Insumo</th><th className={th}>Tipo</th><th className={th}>Cantidad</th><th className={th}>Saldo</th><th className={th}>Detalle</th><th className={th}>Registró</th><th className={th}>Estado</th></tr></thead>
          <tbody className="divide-y divide-[var(--os-border)]">
            {items.map((m) => (
              <tr key={m.id} className={m.status === "ANULADO" ? "opacity-60" : ""} data-testid="movimiento-fila" data-kind={m.kind}>
                <td className={`${td} whitespace-nowrap`}>{fmtDay(m.occurredOn)}</td>
                <td className={td}>{m.insumoName}</td>
                <td className={td}>{STOCK_KIND_LABEL[m.kind]}</td>
                <td className={`${td} tabular-nums`}>{m.kind === "STOCK_INICIAL" ? `= ${fmtN(m.delta)}` : sign(m.delta)} {m.unit}</td>
                <td className={`${td} tabular-nums`}>{m.balance == null ? "—" : fmtN(m.balance)}</td>
                <td className={td}>{detail(m)}</td>
                <td className={td}>{m.createdByName || m.createdBy}</td>
                <td className={td}>{m.status === "ANULADO" ? "ANULADO" : "Activo"}</td>
              </tr>
            ))}
            {state && items.length === 0 ? <tr><td className={td} colSpan={8}>No hay movimientos para los filtros elegidos.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[var(--os-text-muted)]">Saldo «—»: movimiento anterior al stock inicial vigente (se conserva en el historial pero no cuenta).</p>
    </div>
  );
}
