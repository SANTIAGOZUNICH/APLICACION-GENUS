"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History, Pencil, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { formatQty } from "@/lib/planning/circuit/delivery-math";
import { resolveBoxesEntry, samePacking } from "@/lib/remitos/delivery-boxes-input";
import type { PackingGroup } from "@/lib/remitos/packing-math";
import { DeliveryBoxesSection } from "../components/delivery-boxes-section";
import type { InternalDeliveryChangeDto, InternalDeliveryDto } from "@/lib/planning/internal-deliveries-service";

const POLL_MS = 20_000;
const SECTOR_OPTIONS: Array<[string, string]> = [
  ["", "Todos los sectores"],
  ["ELABORACION", "Elaboración"],
  ["ENVASADO_MASIVO", "Envasado Masivo"],
  ["ENVASADO_PREMIUM", "Envasado Premium"],
  ["CODIFICADO", "Codificado"],
];

type Json = Record<string, unknown>;

async function api<T = Json>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", credentials: "same-origin", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const json = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "No se pudo completar la operación.");
  return json as T;
}

const fmt = (n: number | null | undefined) => (n == null ? "—" : new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(n));
const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

/**
 * Entregas internas: las entregas que cada sector hizo a Producción o a Codificado, con sus observaciones, para consultarlas y corregirlas.
 * Cada sector operativo (Elaboración, Envasado Masivo/Premium, Codificado) ve y corrige SOLO las suyas; Producción y Dirección ven y
 * corrigen todas. Los permisos los valida el servidor: acá solo se muestran o se ocultan los botones. Cancelar no borra: la entrega queda
 * visible como «Cancelada» y deja de sumar en los totales.
 */
export function EntregasInternasView() {
  const { sectorId } = usePreviewSession();
  const isAdmin = sectorId === "PRODUCCION" || sectorId === "DIRECCION";
  const [items, setItems] = useState<InternalDeliveryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sector, setSector] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [editing, setEditing] = useState<InternalDeliveryDto | null>(null);
  const [cancelling, setCancelling] = useState<InternalDeliveryDto | null>(null);
  const [history, setHistory] = useState<{ d: InternalDeliveryDto; changes: InternalDeliveryChangeDto[] | null; error?: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    const mine = ++reqRef.current;
    try {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set("q", q.trim());
      if (isAdmin && sector) sp.set("sector", sector);
      if (status) sp.set("status", status);
      if (from) sp.set("from", from);
      if (to) sp.set("to", to);
      const json = await api<{ items: InternalDeliveryDto[] }>(`/api/v1/internal-deliveries?${sp.toString()}`);
      if (mine !== reqRef.current) return; // respuesta vieja de otra búsqueda
      setItems(json.items ?? []);
      setError(null);
    } catch (e) {
      if (mine === reqRef.current) setError(e instanceof Error ? e.message : "No pudimos cargar las entregas.");
    } finally {
      if (mine === reqRef.current) setLoading(false);
    }
  }, [q, sector, status, from, to, isAdmin]);

  useEffect(() => {
    const first = setTimeout(() => void load(), q ? 250 : 0);
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(first); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load, q]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 5000);
  };

  async function openHistory(d: InternalDeliveryDto) {
    setHistory({ d, changes: null });
    try {
      const json = await api<{ changes: InternalDeliveryChangeDto[] }>(`/api/v1/internal-deliveries?history=${d.kind}:${d.id}`);
      setHistory({ d, changes: json.changes });
    } catch (e) {
      setHistory({ d, changes: [], error: e instanceof Error ? e.message : "No pudimos cargar el historial." });
    }
  }

  const activeTotal = useMemo(() => items.filter((i) => i.status === "ACTIVA").reduce((s, i) => s + i.quantity, 0), [items]);

  return (
    <TwinShell title="Entregas internas">
      <div className="mx-auto w-full max-w-[var(--os-content-max,1200px)] space-y-4" data-testid="entregas-internas">
        <header>
          <h2 className="text-2xl font-semibold tracking-tight">Entregas internas</h2>
          <p className="text-sm text-[var(--os-text-muted)]">
            {isAdmin ? "Entregas de todos los sectores a Producción y a Codificado." : "Las entregas de tu sector a Producción y a Codificado."} Podés corregir la cantidad y las observaciones, o cancelar una entrega cargada por error.
          </p>
        </header>

        <div className="flex flex-wrap items-end gap-2" data-testid="ei-filters">
          <label className="flex flex-col text-xs text-[var(--os-text-muted)]">Buscar
            <input className="min-h-10 rounded border border-[var(--os-border)] bg-transparent px-3 text-sm text-[var(--os-text)]" placeholder="Cliente, producto o lote…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="ei-search" />
          </label>
          {isAdmin ? (
            <label className="flex flex-col text-xs text-[var(--os-text-muted)]">Sector
              <select className="min-h-10 rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-2 text-sm text-[var(--os-text)]" value={sector} onChange={(e) => setSector(e.target.value)} data-testid="ei-sector">
                {SECTOR_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          ) : null}
          <label className="flex flex-col text-xs text-[var(--os-text-muted)]">Estado
            <select className="min-h-10 rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-2 text-sm text-[var(--os-text)]" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="ei-status">
              <option value="">Todas</option>
              <option value="ACTIVA">Vigentes</option>
              <option value="CANCELADA">Canceladas</option>
            </select>
          </label>
          <label className="flex flex-col text-xs text-[var(--os-text-muted)]">Desde
            <input type="date" className="min-h-10 rounded border border-[var(--os-border)] bg-transparent px-2 text-sm text-[var(--os-text)]" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="ei-from" />
          </label>
          <label className="flex flex-col text-xs text-[var(--os-text-muted)]">Hasta
            <input type="date" className="min-h-10 rounded border border-[var(--os-border)] bg-transparent px-2 text-sm text-[var(--os-text)]" value={to} onChange={(e) => setTo(e.target.value)} data-testid="ei-to" />
          </label>
          <button type="button" className="ml-auto inline-flex min-h-10 items-center gap-1 rounded border border-[var(--os-border)] px-3 text-sm" onClick={() => void load()} data-testid="ei-refresh">
            <RefreshCw className="size-4" aria-hidden="true" /> Actualizar
          </button>
        </div>

        {toast ? <div role="status" className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm" data-testid="ei-toast">{toast}</div> : null}
        {error ? <div role="alert" className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm" data-testid="ei-error">{error}</div> : null}

        <p className="text-sm text-[var(--os-text-muted)]" data-testid="ei-count">
          {loading ? "Cargando…" : `${items.length} entrega${items.length === 1 ? "" : "s"} · ${fmt(activeTotal)} unidades vigentes`}
        </p>

        <div className="overflow-x-auto rounded border border-[var(--os-border)]">
          <table className="w-full min-w-[1180px] text-left text-sm" data-testid="ei-table">
            <thead className="bg-white/5 text-xs uppercase text-[var(--os-text-muted)]">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Producto</th>
                <th className="px-3 py-2">Lote</th>
                <th className="px-3 py-2">Origen → Destino</th>
                <th className="px-3 py-2 text-right">Cantidad entregada</th>
                <th className="px-3 py-2">Cajas</th>
                <th className="px-3 py-2">Observaciones</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={`${d.kind}:${d.id}`} className={`border-t border-[var(--os-border)] align-top ${d.status === "CANCELADA" ? "opacity-70" : ""}`} data-testid="ei-row" data-delivery-id={d.id} data-kind={d.kind} data-status={d.status}>
                  <td className="whitespace-nowrap px-3 py-2">{fmtDate(d.date)}</td>
                  <td className="px-3 py-2" data-testid="ei-client">{d.client}</td>
                  <td className="px-3 py-2" data-testid="ei-product">{d.product}</td>
                  <td className="px-3 py-2 font-mono text-xs">{d.lote ?? "—"}</td>
                  <td className="px-3 py-2">{d.originLabel} → {d.destinationLabel} <span className="text-xs text-[var(--os-text-muted)]">#{d.sequence}</span></td>
                  <td className={`px-3 py-2 text-right font-semibold tabular-nums ${d.status === "CANCELADA" ? "line-through" : ""}`} data-testid="ei-qty">{fmt(d.quantity)} {d.unit}</td>
                  <td className="max-w-[240px] px-3 py-2 text-xs" data-testid="ei-boxes">{d.boxesText ?? <span className="text-[var(--os-text-muted)]">Sin detalle de cajas</span>}{d.packingInherited ? <span className="block text-[var(--os-text-muted)]">(cajas informadas por Envasado)</span> : null}{d.remito ? <span className="mt-1 block text-[var(--os-text-muted)]" data-testid="ei-remito">En remito {d.remito.number ?? "(borrador)"} · {d.remito.status}</span> : null}</td>
                  <td className="max-w-[260px] whitespace-pre-wrap break-words px-3 py-2" data-testid="ei-observations">{d.observations || <span className="text-[var(--os-text-muted)]">—</span>}</td>
                  <td className="px-3 py-2" data-testid="ei-status-cell">
                    {d.status === "ACTIVA" ? (
                      <span className="text-emerald-300">Vigente</span>
                    ) : (
                      <span className="text-rose-300" title={d.cancelReason ?? ""}>Cancelada{d.cancelReason ? ` · ${d.cancelReason}` : ""}{d.cancelledBy ? ` (${d.cancelledBy})` : ""}</span>
                    )}
                    {d.version > 0 && d.status === "ACTIVA" ? <span className="ml-1 text-xs text-[var(--os-text-muted)]">· editada</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      {d.canManage ? (
                        <>
                          <button type="button" className="inline-flex min-h-9 items-center gap-1 rounded border border-[var(--os-border)] px-2 text-xs" onClick={() => setEditing(d)} data-testid="ei-edit"><Pencil className="size-3.5" aria-hidden="true" /> Editar</button>
                          <button type="button" className="inline-flex min-h-9 items-center gap-1 rounded border border-rose-500/50 px-2 text-xs text-rose-300" onClick={() => setCancelling(d)} data-testid="ei-cancel"><XCircle className="size-3.5" aria-hidden="true" /> Cancelar</button>
                        </>
                      ) : null}
                      {isAdmin || d.canManage || d.version > 0 ? (
                        <button type="button" className="inline-flex min-h-9 items-center gap-1 rounded border border-[var(--os-border)] px-2 text-xs" onClick={() => void openHistory(d)} data-testid="ei-history"><History className="size-3.5" aria-hidden="true" /> Historial</button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && items.length === 0 ? (
                <tr><td colSpan={10} className="px-3 py-6 text-center text-[var(--os-text-muted)]" data-testid="ei-empty">No hay entregas internas para mostrar.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {editing ? (
        <EditDialog
          d={editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); flash(msg); void load(); }}
        />
      ) : null}
      {cancelling ? (
        <CancelDialog
          d={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => { setCancelling(null); flash("Entrega cancelada. Los totales se actualizaron."); void load(); }}
        />
      ) : null}
      {history ? <HistoryDialog state={history} onClose={() => setHistory(null)} /> : null}
    </TwinShell>
  );
}

const describePacking = (g: Array<{ cajas: number; unidadesPorCaja: number }> | null | undefined) =>
  !g || g.length === 0 ? "sin detalle" : g.map((x) => `${x.cajas} × ${x.unidadesPorCaja}`).join(" + ");

function Summary({ d }: { d: InternalDeliveryDto }) {
  return (
    <dl className="grid grid-cols-2 gap-2 rounded border border-[var(--os-border)] p-3 text-sm" data-testid="ei-summary">
      <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Cliente</dt><dd>{d.client}</dd></div>
      <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Producto</dt><dd>{d.product}</dd></div>
      <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Lote</dt><dd className="font-mono text-xs">{d.lote ?? "—"}</dd></div>
      <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Origen → Destino</dt><dd>{d.originLabel} → {d.destinationLabel}</dd></div>
    </dl>
  );
}

function EditDialog({ d, onClose, onSaved }: { d: InternalDeliveryDto; onClose: () => void; onSaved: (message: string) => void }) {
  const [qty, setQty] = useState(formatQty(d.quantity));
  const [obs, setObs] = useState(d.observations ?? "");
  const [boxes, setBoxes] = useState<PackingGroup[]>(d.packingGroups.map((g) => ({ cajas: g.cajas, unidadesPorCaja: g.unidadesPorCaja })));
  const [showBoxes, setShowBoxes] = useState(d.packingGroups.length > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  async function save() {
    if (busyRef.current) return; // doble clic
    setError(null);
    busyRef.current = true;
    setBusy(true);
    try {
      const body: Json = { action: "edit", kind: d.kind, id: d.id, expectedVersion: d.version };
      const typed = Number(qty.trim().replace(/\./g, "").replace(",", "."));
      const entry = resolveBoxesEntry({ quantity: Number.isFinite(typed) ? typed : null, groups: showBoxes ? boxes : [] });
      if (!entry.ok) throw new Error(entry.error);
      if (entry.derivedQuantity && entry.quantity != null) body.quantity = String(entry.quantity);
      else if (qty.trim() !== formatQty(d.quantity)) body.quantity = qty.trim();
      if (!samePacking(entry.groups, d.packingGroups)) body.packingGroups = entry.groups;
      if (obs.trim() !== (d.observations ?? "").trim()) body.observations = obs.trim();
      const res = await api<{ notice?: string | null }>("/api/v1/internal-deliveries", { method: "POST", body: JSON.stringify(body) });
      onSaved(["Entrega actualizada. Los totales se recalcularon.", res.notice].filter(Boolean).join(" "));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar los cambios.");
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent data-testid="ei-edit-dialog">
        <DialogHeader>
          <DialogTitle>Editar entrega</DialogTitle>
          <DialogDescription>Solo se pueden corregir la cantidad entregada y las observaciones. Cliente, producto, lote, origen y destino no cambian.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Summary d={d} />
          <label className="block text-sm">
            <span className="font-medium">Cantidad entregada ({d.unit}) — si cargás cajas, el total se calcula</span>
            <input className="mt-1 w-full rounded border border-[var(--os-border)] bg-transparent px-3 py-2 tabular-nums" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="ei-edit-qty" />
          </label>
          <label className="block text-sm">
            <span className="font-medium">Observaciones (opcional)</span>
            <textarea className="mt-1 w-full rounded border border-[var(--os-border)] bg-transparent px-3 py-2" rows={3} maxLength={1000} value={obs} onChange={(e) => setObs(e.target.value)} data-testid="ei-edit-obs" />
          </label>
          <DeliveryBoxesSection boxes={boxes} onBoxesChange={setBoxes} expected={Number.isFinite(Number(qty.trim().replace(/\./g, "").replace(",", "."))) && qty.trim() !== "" ? Number(qty.trim().replace(/\./g, "").replace(",", ".")) : null} onUseTotal={(t) => setQty(String(t))} open={showBoxes} onOpenChange={setShowBoxes} prefix="ei-edit" label="Cajas de la entrega" />
          {d.remito ? <p className="text-xs text-amber-300" data-testid="ei-edit-remito">Esta entrega ya figura en el remito {d.remito.number ?? "(borrador)"}: no se puede corregir hasta anularlo o reemplazarlo.</p> : null}
          {error ? <p role="alert" className="text-sm text-amber-300" data-testid="ei-edit-error">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cerrar</Button>
          <Button onClick={() => void save()} disabled={busy} data-testid="ei-edit-save">{busy ? "Guardando…" : "Guardar cambios"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ d, onClose, onDone }: { d: InternalDeliveryDto; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  async function confirm() {
    if (busyRef.current) return;
    if (!reason.trim()) { setError("Indicá el motivo de la cancelación."); return; }
    setError(null);
    busyRef.current = true;
    setBusy(true);
    try {
      await api("/api/v1/internal-deliveries", { method: "POST", body: JSON.stringify({ action: "cancel", kind: d.kind, id: d.id, reason: reason.trim(), expectedVersion: d.version }) });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos cancelar la entrega.");
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent data-testid="ei-cancel-dialog">
        <DialogHeader>
          <DialogTitle>Cancelar entrega</DialogTitle>
          <DialogDescription>
            La entrega de {fmt(d.quantity)} {d.unit} dejará de sumar en las cantidades entregadas y recibidas, y se recalcularán los pendientes. No se elimina: queda en el historial como «Cancelada».
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Summary d={d} />
          <label className="block text-sm">
            <span className="font-medium">Motivo de la cancelación</span>
            <textarea className="mt-1 w-full rounded border border-[var(--os-border)] bg-transparent px-3 py-2" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="ei-cancel-reason" />
          </label>
          {error ? <p role="alert" className="text-sm text-amber-300" data-testid="ei-cancel-error">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Volver</Button>
          <Button onClick={() => void confirm()} disabled={busy} data-testid="ei-cancel-confirm">{busy ? "Cancelando…" : "Cancelar entrega"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ state, onClose }: { state: { d: InternalDeliveryDto; changes: InternalDeliveryChangeDto[] | null; error?: string }; onClose: () => void }) {
  const { d, changes } = state;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-testid="ei-history-dialog">
        <DialogHeader>
          <DialogTitle>Historial de la entrega</DialogTitle>
          <DialogDescription>{d.product} · {d.client} · {d.originLabel} → {d.destinationLabel} #{d.sequence}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto text-sm">
          {changes === null ? <p>Cargando…</p> : null}
          {state.error ? <p role="alert" className="text-amber-300">{state.error}</p> : null}
          {changes && changes.length === 0 && !state.error ? <p className="text-[var(--os-text-muted)]" data-testid="ei-history-empty">Esta entrega no fue modificada desde que se registró.</p> : null}
          {changes?.map((c) => (
            <div key={c.id} className="rounded border border-[var(--os-border)] p-2" data-testid="ei-history-entry">
              <p className="font-medium">{c.action === "CANCELAR" ? "Cancelación" : "Edición"} · {fmtDate(c.createdAt)}</p>
              <p className="text-xs text-[var(--os-text-muted)]">{c.actorName ?? c.actorEmail} · {c.actorSectorLabel}</p>
              {c.action === "EDITAR" && c.oldQuantity !== c.newQuantity ? <p>Cantidad: {fmt(c.oldQuantity)} → {fmt(c.newQuantity)} {d.unit}</p> : null}
              {c.action === "EDITAR" && (c.oldObservations ?? "") !== (c.newObservations ?? "") ? <p className="whitespace-pre-wrap">Observaciones: «{c.oldObservations ?? "—"}» → «{c.newObservations ?? "—"}»</p> : null}
              {JSON.stringify(c.oldPacking ?? []) !== JSON.stringify(c.newPacking ?? []) && c.action === "EDITAR" ? <p data-testid="ei-history-packing">Cajas: {describePacking(c.oldPacking)} → {describePacking(c.newPacking)}</p> : null}
              {c.finishedBefore !== c.finishedAfter ? <p>Unidades realizadas del trabajo: {c.finishedBefore ?? "—"} → {c.finishedAfter ?? "—"}</p> : null}
              {c.action === "CANCELAR" ? <p>Motivo: {c.reason ?? "—"} (era de {fmt(c.oldQuantity)} {d.unit})</p> : null}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
