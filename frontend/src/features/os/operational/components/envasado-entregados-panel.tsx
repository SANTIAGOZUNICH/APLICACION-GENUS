"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { InternalDeliveryDto } from "@/lib/planning/internal-deliveries-service";

const PAGE = 30;
const POLL_MS = 15_000;
const fmt = (n: number | null | undefined) => (n == null ? "—" : new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(n));
const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

type Page = { items: InternalDeliveryDto[]; hasMore: boolean; hiddenCount: number };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", credentials: "same-origin", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "No se pudo completar la operación.");
  return json as T;
}

/**
 * Envasado Masivo / Premium → «Entregados»: todas las entregas (parciales y totales) que hizo el sector, a Producción o a Codificado.
 * Fuente única: el listado de entregas internas (renglones de entrega + entregas a Codificado). «Quitar del listado» es solo una
 * preferencia de pantalla (soft-hide por sector): no anula ni modifica la entrega, el trabajo, remitos, recepciones ni stock.
 */
export function EnvasadoEntregadosPanel({ notify, refreshKey = 0 }: { notify: (m: string, tone?: "info") => void; refreshKey?: number }) {
  const [items, setItems] = useState<InternalDeliveryDto[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState<"" | "PARCIAL" | "TOTAL">("");
  const [showHidden, setShowHidden] = useState(false);
  const [confirm, setConfirm] = useState<InternalDeliveryDto | null>(null);
  const [busy, setBusy] = useState(false);
  const reqRef = useRef(0);
  const loadedRef = useRef(PAGE);

  const query = useCallback(
    (offset: number, limit: number) => {
      const sp = new URLSearchParams({ hidden: showHidden ? "only" : "exclude", limit: String(limit), offset: String(offset) });
      if (q.trim()) sp.set("q", q.trim());
      if (tipo) sp.set("tipo", tipo);
      return `/api/v1/internal-deliveries?${sp.toString()}`;
    },
    [q, tipo, showHidden]
  );

  // Recarga lo que ya está a la vista (primera página + las «Ver más» abiertas), para que el sondeo no pierda la posición.
  const reload = useCallback(async () => {
    const mine = ++reqRef.current;
    try {
      const page = await call<Page>(query(0, Math.max(loadedRef.current, PAGE)));
      if (mine !== reqRef.current) return;
      setItems(page.items ?? []);
      setHasMore(Boolean(page.hasMore));
      setHiddenCount(page.hiddenCount ?? 0);
      setError(null);
    } catch (e) {
      if (mine === reqRef.current) setError(e instanceof Error ? e.message : "No pudimos cargar las entregas.");
    } finally {
      if (mine === reqRef.current) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    loadedRef.current = PAGE;
  }, [q, tipo, showHidden]);

  useEffect(() => {
    const first = setTimeout(() => void reload(), q ? 250 : 0);
    const timer = setInterval(() => { if (document.visibilityState === "visible") void reload(); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void reload(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(first); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [reload, q, refreshKey]);

  async function more() {
    setLoadingMore(true);
    try {
      const page = await call<Page>(query(items.length, PAGE));
      loadedRef.current = items.length + (page.items?.length ?? 0);
      setItems((cur) => {
        const seen = new Set(cur.map((i) => `${i.kind}:${i.id}`));
        return [...cur, ...(page.items ?? []).filter((i) => !seen.has(`${i.kind}:${i.id}`))];
      });
      setHasMore(Boolean(page.hasMore));
    } catch (e) {
      notify(e instanceof Error ? e.message : "No pudimos cargar más entregas.", "info");
    } finally {
      setLoadingMore(false);
    }
  }

  async function setHidden(d: InternalDeliveryDto, hidden: boolean) {
    setBusy(true);
    try {
      await call("/api/v1/internal-deliveries", { method: "POST", body: JSON.stringify({ action: hidden ? "hide" : "restore", kind: d.kind, id: d.id }) });
      setConfirm(null);
      notify(hidden ? "Entrega quitada del listado (sigue guardada; podés verla en «Mostrar ocultos»)." : "Entrega restaurada en el listado.");
      await reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : "No se pudo completar la operación.", "info");
    } finally {
      setBusy(false);
    }
  }

  const input = "min-h-10 rounded border border-[var(--os-border)] bg-transparent px-3 text-sm text-[var(--os-text)]";
  return (
    <section className="space-y-3" data-testid="envasado-entregados">
      <div className="flex flex-wrap items-end gap-2" data-testid="entregados-filters">
        <label className="flex min-w-[12rem] flex-1 flex-col text-xs text-[var(--os-text-muted)]">Buscar
          <input className={input} placeholder="Cliente, producto o lote…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="entregados-q" />
        </label>
        <label className="flex flex-col text-xs text-[var(--os-text-muted)]">Tipo
          <select className={`${input} bg-[var(--os-surface)]`} value={tipo} onChange={(e) => setTipo(e.target.value as "" | "PARCIAL" | "TOTAL")} data-testid="entregados-tipo">
            <option value="">Parciales y totales</option>
            <option value="PARCIAL">Solo parciales</option>
            <option value="TOTAL">Solo totales / finales</option>
          </select>
        </label>
        <Button type="button" variant={showHidden ? "primary" : "secondary"} onClick={() => setShowHidden((v) => !v)} data-testid="entregados-toggle-hidden">
          {showHidden ? <><Eye className="mr-1 inline size-4" />Volver al listado</> : <><EyeOff className="mr-1 inline size-4" />Mostrar ocultos{hiddenCount > 0 ? ` (${hiddenCount})` : ""}</>}
        </Button>
      </div>
      <p className="text-xs text-[var(--os-text-muted)]">
        {showHidden
          ? "Entregas que quitaste de tu listado. Siguen guardadas y visibles para Producción y Dirección; podés restaurarlas."
          : "Entregas de tu sector (parciales y totales), las más recientes primero. «Quitar del listado» solo limpia esta pantalla: no anula ni modifica la entrega."}
      </p>
      {error ? <p className="rounded border border-rose-500/40 px-3 py-2 text-sm text-rose-300" role="alert">{error}</p> : null}

      <ul className="space-y-2" data-testid="entregados-list">
        {items.map((d) => (
          <li
            key={`${d.kind}:${d.id}`}
            className={`rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-3 ${d.status === "CANCELADA" ? "opacity-70" : ""}`}
            data-testid="entregado-row"
            data-delivery-id={d.id}
            data-kind={d.kind}
            data-tipo={d.tipo ?? ""}
            data-hidden={d.hidden ? "1" : "0"}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-[var(--os-text-muted)]">{fmtDate(d.date)} · entrega #{d.sequence}</p>
                <p className="font-semibold" data-testid="entregado-product">{d.product}</p>
                <p className="text-sm text-[var(--os-text-muted)]"><span data-testid="entregado-client">{d.client || "Sin cliente"}</span> · Lote {d.lote ?? "—"}</p>
              </div>
              <div className="text-right">
                <p className={`text-lg font-semibold tabular-nums ${d.status === "CANCELADA" ? "line-through" : ""}`} data-testid="entregado-qty">{fmt(d.quantity)} {d.unit}</p>
                <p className="text-xs">
                  <span className={`rounded px-1.5 py-0.5 ${d.tipo === "PARCIAL" ? "bg-amber-500/15 text-amber-300" : d.tipo === "TOTAL" ? "bg-emerald-500/15 text-emerald-300" : "text-[var(--os-text-muted)]"}`} data-testid="entregado-tipo">
                    {d.tipo === "PARCIAL" ? "Parcial" : d.tipo === "TOTAL" ? "Total / Final" : "Sin dato de saldo"}
                  </span>
                  {d.status === "CANCELADA" ? <span className="ml-1 text-rose-300" data-testid="entregado-cancelada">Cancelada</span> : null}
                </p>
              </div>
            </div>
            <div className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2 xl:grid-cols-4">
              <p><span className="text-xs text-[var(--os-text-muted)]">Sector → Destino </span>{d.originLabel} → {d.destinationLabel}</p>
              <p><span className="text-xs text-[var(--os-text-muted)]">Cajas </span>{d.cajas > 0 ? `${d.cajas}` : "—"}</p>
              <p><span className="text-xs text-[var(--os-text-muted)]">Usuario </span>{d.deliveredBy || "—"}</p>
              <p className="break-words"><span className="text-xs text-[var(--os-text-muted)]">Observaciones </span>{d.observations || "—"}</p>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <details className="text-sm">
                <summary className="cursor-pointer text-xs text-[var(--os-text-muted)]" data-testid="entregado-detalle">Ver detalle</summary>
                <dl className="mt-1 space-y-0.5 text-xs">
                  <div><dt className="inline text-[var(--os-text-muted)]">Cajas: </dt><dd className="inline">{d.boxesText ?? "Sin detalle de cajas"}{d.packingInherited ? " (informadas en la entrega a Codificado)" : ""}</dd></div>
                  <div><dt className="inline text-[var(--os-text-muted)]">Acumulado / saldo después de esta entrega: </dt><dd className="inline">{fmt(d.cumulative)} / {fmt(d.pending)} {d.unit}</dd></div>
                  {d.remito ? <div><dt className="inline text-[var(--os-text-muted)]">Remito: </dt><dd className="inline">{d.remito.number ?? "—"} ({d.remito.status})</dd></div> : null}
                  {d.status === "CANCELADA" ? <div><dt className="inline text-[var(--os-text-muted)]">Cancelada: </dt><dd className="inline">{d.cancelReason ?? "—"}{d.cancelledBy ? ` (${d.cancelledBy})` : ""}</dd></div> : null}
                  {d.version > 0 ? <div className="text-[var(--os-text-muted)]">Fue corregida {d.version} vez/veces (ver «Entregas internas» para el historial).</div> : null}
                </dl>
              </details>
              {d.hidden ? (
                <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void setHidden(d, false)} data-testid="entregado-restore"><RotateCcw className="mr-1 inline size-4" />Restaurar</Button>
              ) : (
                <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setConfirm(d)} data-testid="entregado-hide"><EyeOff className="mr-1 inline size-4" />Quitar del listado</Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!loading && items.length === 0 ? (
        <p className="rounded border border-[var(--os-border)] px-3 py-6 text-center text-sm text-[var(--os-text-muted)]" data-testid="entregados-empty">
          {showHidden ? "No hay entregas ocultas." : "Todavía no hay entregas para mostrar."}
        </p>
      ) : null}
      {loading ? <div className="os-skeleton h-24 rounded-[var(--os-radius)]" /> : null}
      {hasMore ? (
        <div className="flex justify-center">
          <Button type="button" variant="secondary" disabled={loadingMore} onClick={() => void more()} data-testid="entregados-more">{loadingMore ? "Cargando…" : "Ver más"}</Button>
        </div>
      ) : null}

      <Dialog open={Boolean(confirm)} onOpenChange={(o) => { if (!o && !busy) setConfirm(null); }}>
        <DialogContent data-testid="entregado-hide-confirm">
          <DialogHeader>
            <DialogTitle>¿Quitar esta entrega del listado?</DialogTitle>
            <DialogDescription>
              {confirm ? `${confirm.product} · ${fmt(confirm.quantity)} ${confirm.unit}. ` : ""}
              Solo se oculta de esta pantalla. La entrega NO se anula ni se modifica: sus cantidades, el trabajo, los remitos y las recepciones siguen igual. Podés verla y restaurarla desde «Mostrar ocultos».
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirm(null)}>Cancelar</Button>
            <Button type="button" variant="primary" disabled={busy} onClick={() => confirm && void setHidden(confirm, true)} data-testid="entregado-hide-confirm-yes">Quitar del listado</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
