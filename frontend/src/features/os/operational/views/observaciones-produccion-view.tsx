"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { usePreviewContext } from "@/features/os/session/preview-context";
import { ObservationItem, type ProductionObservation } from "../components/work-observations";

const POLL_MS = 20_000;
const SECTOR_OPTIONS: Array<[string, string]> = [
  ["", "Todos los sectores"],
  ["ELABORACION", "Elaboración"],
  ["ENVASADO_MASIVO", "Envasado Masivo"],
  ["ENVASADO_PREMIUM", "Envasado Premium"],
  ["CODIFICADO", "Codificado"],
];

interface FeedPayload {
  items: ProductionObservation[];
  total: number;
  news: number;
  hasMore: boolean;
}

/**
 * Observaciones: lo que los sectores productivos escriben al entregar (parcial o total), de todos los sectores, de la más reciente a la
 * más antigua. Es una vista de solo lectura sobre las entregas reales: no duplica ni modifica nada. Cada observación se abre en su trabajo.
 */
export function ObservacionesProduccionView() {
  const { openWorkItem } = usePreviewContext();
  const [data, setData] = useState<FeedPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sector, setSector] = useState("");
  const [q, setQ] = useState("");
  const [onlyNew, setOnlyNew] = useState(false);
  const [limit, setLimit] = useState(100);
  const [busy, setBusy] = useState(false);
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    const mine = ++reqRef.current;
    try {
      const sp = new URLSearchParams();
      if (sector) sp.set("sector", sector);
      if (q.trim()) sp.set("q", q.trim());
      if (onlyNew) sp.set("onlyNew", "1");
      sp.set("limit", String(limit));
      const res = await fetch(`/api/v1/production-observations?${sp.toString()}`, { cache: "no-store", credentials: "same-origin" });
      const json = (await res.json().catch(() => ({}))) as FeedPayload & { error?: string };
      if (!res.ok) throw new Error(json.error || "No pudimos cargar las observaciones.");
      if (mine !== reqRef.current) return;
      setData(json);
      setError(null);
    } catch (e) {
      if (mine === reqRef.current) setError(e instanceof Error ? e.message : "No pudimos cargar las observaciones.");
    }
  }, [sector, q, onlyNew, limit]);

  useEffect(() => {
    const first = setTimeout(() => void load(), q ? 250 : 0);
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(first); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load, q]);

  async function markAllSeen() {
    setBusy(true);
    try {
      await fetch("/api/v1/production-observations", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "seen", scope: "FEED" }) });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <TwinShell title="Observaciones">
      <div className="mx-auto w-full max-w-[var(--os-content-max,1200px)] space-y-4" data-testid="observaciones-produccion">
        <header>
          <h2 className="text-2xl font-semibold tracking-tight">Observaciones</h2>
          <p className="text-sm text-[var(--os-text-muted)]">
            Las observaciones que Elaboración, Envasado y Codificado escriben al entregar, en cuanto se registran. Cada una queda ligada a su entrega y a su trabajo.
          </p>
        </header>

        <div className="flex flex-wrap items-end gap-2" data-testid="obs-filters">
          <label className="flex flex-col text-xs text-[var(--os-text-muted)]">Sector
            <select className="min-h-10 rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-2 text-sm text-[var(--os-text)]" value={sector} onChange={(e) => { setSector(e.target.value); setLimit(100); }} data-testid="obs-sector">
              {SECTOR_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="flex min-w-[12rem] flex-1 flex-col text-xs text-[var(--os-text-muted)]">Cliente, pedido, producto o lote
            <input className="min-h-10 rounded border border-[var(--os-border)] bg-transparent px-3 text-sm text-[var(--os-text)]" placeholder="Buscar…" value={q} onChange={(e) => { setQ(e.target.value); setLimit(100); }} data-testid="obs-search" />
          </label>
          <label className="flex min-h-10 items-center gap-2 text-sm text-[var(--os-text)]">
            <input type="checkbox" checked={onlyNew} onChange={(e) => { setOnlyNew(e.target.checked); setLimit(100); }} data-testid="obs-only-new" />
            Solo nuevas{data ? ` (${data.news})` : ""}
          </label>
          <button type="button" disabled={busy || !data || data.news === 0} onClick={() => void markAllSeen()} className="min-h-10 rounded border border-[var(--os-border)] px-3 text-sm font-semibold text-[var(--os-text)] disabled:opacity-50" data-testid="obs-mark-seen">
            Marcar todas como vistas
          </button>
        </div>

        {error ? <p role="alert" className="text-sm text-amber-500" data-testid="obs-error">{error}</p> : null}
        {!data && !error ? <p className="text-sm text-[var(--os-text-muted)]">Cargando…</p> : null}
        {data && data.items.length === 0 ? <p className="text-sm text-[var(--os-text-muted)]" data-testid="obs-empty">No hay observaciones para mostrar.</p> : null}
        {data && data.items.length > 0 ? (
          <ul className="space-y-2 rounded-xl bg-[#0f2634] p-3" data-testid="obs-list">
            {data.items.map((o) => (
              <ObservationItem key={o.id} o={o} showWork>
                <div className="mt-2">
                  <button type="button" onClick={() => openWorkItem(`native:${o.workItemId}`)} className="min-h-9 rounded-lg border border-[var(--os-teal)]/60 px-3 text-[13px] font-semibold text-[var(--os-teal)]" data-testid="obs-open-work">
                    Abrir trabajo
                  </button>
                </div>
              </ObservationItem>
            ))}
          </ul>
        ) : null}
        {data?.hasMore ? (
          <button type="button" onClick={() => setLimit((n) => n + 100)} className="min-h-10 rounded border border-[var(--os-border)] px-4 text-sm font-semibold" data-testid="obs-more">Ver más</button>
        ) : null}
      </div>
    </TwinShell>
  );
}
