"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageSquareText } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isNativeWorkItemId } from "@/lib/planning/work-item-cell-edit";
import type { ProductionObservation } from "@/lib/observations/production-observations-core";
import { formatCommentWhen } from "./job-comments";

export type { ProductionObservation };

export interface WorkObservationsPayload {
  workItemId: string;
  chain: Array<{ id: string; sector: string; sectorLabel: string; orderNumber: string | null; deleted: boolean }>;
  items: ProductionObservation[];
  total: number;
  news: number;
  anuladas: number;
}

const rawId = (id: string) => id.replace(/^native:/, "").toLowerCase();
const fmtQty = (n: number | null, unit: string | null) => (n == null ? null : `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(n)}${unit ? ` ${unit}` : ""}`);

// ───────────────────────── Resumen por trabajo (una sola consulta para todas las tarjetas) ─────────────────────────

type Summary = { total: number; news: number };
const cache = new Map<string, { at: number; value: Summary | null }>();
const listeners = new Set<() => void>();
const queue = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
const TTL_MS = 20_000;

async function flush() {
  timer = null;
  const ids = [...queue];
  queue.clear();
  if (ids.length === 0) return;
  try {
    const res = await fetch(`/api/v1/production-observations?workItemIds=${ids.join(",")}`, { cache: "no-store", credentials: "same-origin" });
    const json = (await res.json().catch(() => ({}))) as { summary?: Record<string, Summary> };
    const now = Date.now();
    // Sin permiso / sin datos: el trabajo no figura en la respuesta → el botón no se muestra.
    for (const id of ids) cache.set(id, { at: now, value: res.ok ? (json.summary?.[id] ?? null) : null });
  } catch {
    const now = Date.now();
    for (const id of ids) cache.set(id, { at: now, value: null });
  }
  listeners.forEach((l) => l());
}

function request(id: string) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return;
  queue.add(id);
  if (!timer) timer = setTimeout(() => void flush(), 40);
}

/** Fuerza releer el resumen del trabajo (p. ej. después de marcarlo como visto). */
export function invalidateObservationSummary(id: string, value?: Summary) {
  const key = rawId(id);
  if (value) cache.set(key, { at: Date.now(), value });
  else cache.delete(key);
  listeners.forEach((l) => l());
}

export function useObservationSummary(workItemId: string): Summary | null {
  const key = rawId(workItemId);
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    request(key);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") request(key);
    }, TTL_MS);
    return () => {
      listeners.delete(l);
      clearInterval(t);
    };
  }, [key]);
  return cache.get(key)?.value ?? null;
}

// ───────────────────────── Lista de observaciones ─────────────────────────

const ORIGIN_TONE: Record<string, string> = {
  ELABORACION: "bg-sky-400/20 text-sky-100",
  ENVASADO_MASIVO: "bg-violet-400/20 text-violet-100",
  ENVASADO_PREMIUM: "bg-fuchsia-400/20 text-fuchsia-100",
  CODIFICADO: "bg-emerald-400/20 text-emerald-100",
};

export function ObservationItem({ o, showWork = false, children }: { o: ProductionObservation; showWork?: boolean; children?: React.ReactNode }) {
  const qty = fmtQty(o.quantity, o.unit);
  return (
    <li
      className={`rounded-lg border px-3 py-2.5 ${o.anulada ? "border-white/10 bg-white/[0.03] opacity-80" : o.isNew ? "border-amber-300/50 bg-amber-300/10" : "border-white/10 bg-white/[0.06]"}`}
      data-testid="observation-item"
      data-observation-id={o.id}
      data-new={o.isNew ? "1" : "0"}
      data-anulada={o.anulada ? "1" : "0"}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
        <span className={`rounded-full px-2 py-0.5 ${ORIGIN_TONE[o.sector] ?? "bg-white/10 text-[#cfe0ea]"}`} data-testid="observation-sector">{o.sectorLabel}</span>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[#cfe0ea]" data-testid="observation-origin">{o.originLabel}{o.sequence ? ` #${o.sequence}` : ""}</span>
        {o.tipo ? <span className="rounded-full bg-white/10 px-2 py-0.5 text-[#cfe0ea]" data-testid="observation-tipo">{o.tipo === "PARCIAL" ? "Parcial" : "Total"}</span> : null}
        {o.isNew ? <span className="rounded-full bg-amber-300 px-2 py-0.5 text-[#3a2a00]" data-testid="observation-new">Nueva</span> : null}
        {o.anulada ? <span className="rounded-full bg-rose-400/25 px-2 py-0.5 text-rose-100" data-testid="observation-anulada">Entrega anulada</span> : null}
        {o.edited ? <span className="rounded-full bg-white/10 px-2 py-0.5 text-[#cfe0ea]">Editada</span> : null}
      </div>
      <p className="mt-1 text-[12px] text-[#9fb4c0]">
        <span className="font-semibold text-[#eaf3f6]" data-testid="observation-by">{o.deliveredBy}</span>
        {o.deliveredBySector && o.deliveredBySector !== o.sector ? ` (${o.deliveredBySector === "PRODUCCION" ? "Producción" : o.deliveredBySector})` : ""}
        {" · "}<time dateTime={o.at}>{formatCommentWhen(o.at)}</time>
        {qty ? <>{" · "}<span data-testid="observation-qty">{qty}</span></> : null}
      </p>
      {showWork ? (
        <p className="mt-0.5 text-[12px] text-[#cfe0ea]" data-testid="observation-work">
          <b>{o.client}</b> · {o.product}
          {o.pedidoOp ? ` · Pedido ${o.pedidoOp}` : ""}
          {o.orderNumber ? ` · ${o.orderNumber}` : ""}
          {o.lote ? ` · Lote ${o.lote}` : ""}
        </p>
      ) : (o.pedidoOp || o.orderNumber || o.lote) ? (
        <p className="mt-0.5 text-[12px] text-[#9fb4c0]">
          {[o.pedidoOp ? `Pedido ${o.pedidoOp}` : null, o.orderNumber, o.lote ? `Lote ${o.lote}` : null].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      <p className="mt-1 whitespace-pre-wrap break-words text-[14px] text-[#eaf3f6]" data-testid="observation-text">{o.text}</p>
      {children}
    </li>
  );
}

// ───────────────────────── Botón + diálogo por trabajo ─────────────────────────

/**
 * «Observaciones (N)» de un trabajo: insignia con la cantidad y señal de NUEVAS (desde la última visita del usuario). Abre el historial
 * cronológico de TODA la cadena del trabajo (etapa anterior y posterior). Solo para trabajos nativos; si el usuario no tiene permiso no se muestra.
 */
export function WorkObservationsButton({ workItemId, className = "" }: { workItemId: string; className?: string }) {
  const native = isNativeWorkItemId(workItemId);
  const summary = useObservationSummary(native ? workItemId : "");
  const [open, setOpen] = useState(false);
  if (!native || !summary) return null;
  const has = summary.total > 0;
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold ${summary.news > 0 ? "border-amber-300/70 bg-amber-300/20 text-amber-100" : has ? "border-[var(--os-teal)]/50 bg-[var(--os-teal)]/10 text-[var(--os-teal)]" : "border-white/15 text-[#9fb4c0]"} ${className}`}
        data-testid="work-observations-button"
        data-count={summary.total}
        data-new={summary.news}
      >
        <MessageSquareText className="size-4" aria-hidden="true" />
        Observaciones ({summary.total})
        {summary.news > 0 ? <span className="rounded-full bg-amber-300 px-1.5 text-[11px] font-bold text-[#3a2a00]" data-testid="work-observations-new">{summary.news} {summary.news === 1 ? "nueva" : "nuevas"}</span> : null}
      </button>
      {open ? <WorkObservationsDialog workItemId={workItemId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function WorkObservationsDialog({ workItemId, onClose }: { workItemId: string; onClose: () => void }) {
  const [data, setData] = useState<WorkObservationsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = rawId(workItemId);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/production-observations?workItemId=${encodeURIComponent(id)}`, { cache: "no-store", credentials: "same-origin" });
      const json = (await res.json().catch(() => ({}))) as WorkObservationsPayload & { error?: string };
      if (!res.ok) throw new Error(json.error || "No pudimos cargar las observaciones.");
      setData(json);
      setError(null);
      // Se muestran las «Nuevas» tal como estaban al abrir; recién entonces se marcan como vistas.
      void fetch("/api/v1/production-observations", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "seen", scope: id }) })
        .then((r) => { if (r.ok) invalidateObservationSummary(id, { total: json.total, news: 0 }); })
        .catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos cargar las observaciones.");
    }
  }, [id]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const first = data?.items[0];
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[90dvh] w-[min(42rem,calc(100vw-16px))] max-w-[min(42rem,calc(100vw-16px))] flex-col gap-3 p-4 sm:p-5" data-testid="work-observations-dialog">
        <DialogHeader>
          <DialogTitle>Observaciones{data ? ` (${data.total})` : ""}</DialogTitle>
          <DialogDescription>
            {first ? `${first.client} · ${first.product}` : "Historial de observaciones de las entregas de este trabajo, de todas sus etapas."}
          </DialogDescription>
        </DialogHeader>
        {data && data.chain.length > 1 ? (
          <p className="text-[12px] text-[#9fb4c0]" data-testid="work-observations-chain">
            Etapas del trabajo: {[...new Set(data.chain.map((c) => c.sectorLabel))].join(" → ")}
          </p>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {error ? <p role="alert" className="text-[13px] text-amber-300" data-testid="work-observations-error">{error}</p> : null}
          {!data && !error ? <p className="text-[13px] text-[#9fb4c0]">Cargando…</p> : null}
          {data && data.items.length === 0 ? <p className="text-[13px] text-[#9fb4c0]" data-testid="work-observations-empty">Este trabajo todavía no tiene observaciones.</p> : null}
          {data && data.items.length > 0 ? (
            <ul className="space-y-2" data-testid="work-observations-list">
              {data.items.map((o) => <ObservationItem key={o.id} o={o} />)}
            </ul>
          ) : null}
        </div>
        {data && data.anuladas > 0 ? <p className="text-[11px] text-[#9fb4c0]">Las entregas anuladas se muestran marcadas y no cuentan en el total.</p> : null}
      </DialogContent>
    </Dialog>
  );
}
