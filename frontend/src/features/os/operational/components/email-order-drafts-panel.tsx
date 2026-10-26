"use client";

/**
 * Pedidos recibidos por email (PILOTO) — sección compacta dentro de Pedidos. «ANALIZAR CORREOS» lee hasta 10 correos de la casilla de pedidos,
 * la IA los interpreta y quedan BORRADORES pendientes: nada se crea hasta que Producción aprueba. Ver docss/PEDIDOS_EMAIL_GMAIL.md.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import type { DraftRow, AnalyzeResult } from "@/lib/email-orders/service";
import type { DraftItem, DraftPayload } from "@/lib/email-orders/types";

type Status = {
  account: string;
  oauth: { ready: boolean; missing: string[]; invalid: Array<{ name: string; problem: string }>; keyFormat: string | null };
  aiAvailable: boolean;
  aiReason: string;
  dbReady: boolean;
  connected: boolean;
  connectedAt: string | null;
  connectedBy: string | null;
  lastError: string | null;
  lastAnalyzedAt: string | null;
  metrics: { mensajes: number; sinPedido: number; conError: number; borradores: number; pendientes: number; aprobados: number; aprobadosSinCambios: number; aprobadosCorregidos: number; descartados: number; renglonesCargados: number } | null;
};

const field = "w-full rounded border border-[var(--os-border)] bg-transparent px-2 py-1 text-sm";

export function EmailOrderDraftsPanel({ email, sector, onPedidosCreated }: { email: string; sector: string; onPedidosCreated: () => void }) {
  const headers = useMemo(() => ({ "Content-Type": "application/json", [ACTOR_EMAIL_HEADER]: email, [ACTOR_SECTOR_HEADER]: sector }), [email, sector]);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [max, setMax] = useState(10);
  const [after, setAfter] = useState("");
  const [before, setBefore] = useState("");
  const [result, setResult] = useState<AnalyzeResult | null>(null);

  const api = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const res = await fetch(path, { credentials: "include", cache: "no-store", ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
      const body = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "No se pudo completar la operación.");
      return body;
    },
    [headers]
  );
  const refresh = useCallback(async () => {
    try {
      const s = await api<Status>("/api/v1/email-orders/status");
      setStatus(s);
      if (s.dbReady) setDrafts((await api<{ items: DraftRow[] }>("/api/v1/email-orders/drafts")).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo consultar");
    }
  }, [api]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial
    void refresh();
    const q = new URLSearchParams(window.location.search);
    if (q.get("gmail")) {
      setOpen(true);
      (q.get("gmail") === "ok" ? setNotice : setError)(q.get("msg") ?? "");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refresh]);

  async function analyze() {
    setBusy("analizando");
    setError(null);
    setNotice(null);
    try {
      const r = await api<{ result: AnalyzeResult }>("/api/v1/email-orders/analyze", { method: "POST", body: JSON.stringify({ max, afterDate: after || undefined, beforeDate: before || undefined }) });
      setResult(r.result);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo analizar");
    } finally {
      setBusy(null);
    }
  }
  async function disconnect() {
    if (!window.confirm("¿Desconectar la casilla de pedidos? Se borra el acceso guardado y se revoca en Google. Los borradores existentes se conservan.")) return;
    setBusy("desconectando");
    try {
      await api("/api/v1/email-orders/disconnect", { method: "POST", body: "{}" });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo desconectar");
    } finally {
      setBusy(null);
    }
  }

  const pending = drafts.filter((d) => d.status === "PENDIENTE" || d.status === "APROBANDO");
  return (
    <section className="rounded border border-[var(--os-border)] p-2.5" data-testid="email-pedidos">
      <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="email-pedidos-toggle">
        <h3 className="text-sm font-semibold">Pedidos recibidos por email <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-normal">PILOTO</span></h3>
        <span className="ml-auto text-xs text-[var(--os-text-muted)]" data-testid="email-pedidos-resumen">
          {pending.length ? `${pending.length} pendiente${pending.length === 1 ? "" : "s"} de revisión` : status?.connected ? "sin pendientes" : "casilla no conectada"} · {open ? "ocultar" : "ver"}
        </span>
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          {notice ? <p className="rounded border border-emerald-400/60 bg-emerald-400/10 px-2.5 py-1.5 text-xs" role="status">{notice}</p> : null}
          {error ? <p className="rounded border border-rose-500/60 bg-rose-500/10 px-2.5 py-1.5 text-xs" role="alert" data-testid="email-pedidos-error">{error}</p> : null}
          {status && !status.dbReady ? <p className="text-xs">Requiere la base de datos configurada.</p> : null}
          {status && !status.oauth.ready ? (
            <p className="rounded border border-amber-400/60 bg-amber-400/10 px-2.5 py-1.5 text-xs" data-testid="email-pedidos-config">
              {status.oauth.missing.length ? <>No llegan al servidor (revisá el entorno Production y hacé un redeploy después de crearlas): {status.oauth.missing.join(", ")}. </> : null}
              {status.oauth.invalid.length ? <>Mal configuradas: {status.oauth.invalid.map((i) => `${i.name} (${i.problem === "demasiado_corta" ? "demasiado corta, mínimo 32 caracteres" : "vacía"})`).join(", ")}. </> : null}
              Ver docss/PEDIDOS_EMAIL_GMAIL.md.
            </p>
          ) : null}
          {status && !status.connected && status.oauth.ready ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span>Casilla autorizada: <b>{status.account}</b>. Se pide solo permiso de LECTURA de Gmail.</span>
              <a className="inline-flex min-h-10 items-center rounded bg-[var(--os-teal,#0d9488)] px-3 text-sm font-semibold text-white" href="/api/v1/email-orders/oauth/start" data-testid="email-pedidos-conectar">Conectar casilla de pedidos</a>
            </div>
          ) : null}
          {status?.connected ? (
            <div className="flex flex-wrap items-end gap-2 text-xs">
              <label>Correos recientes (máx. 10)
                <select className={`${field} min-h-10`} value={max} onChange={(e) => setMax(Number(e.target.value))} data-testid="email-pedidos-max">
                  {[3, 5, 10].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label>Desde<input type="date" className={`${field} min-h-10`} value={after} onChange={(e) => setAfter(e.target.value)} /></label>
              <label>Hasta<input type="date" className={`${field} min-h-10`} value={before} onChange={(e) => setBefore(e.target.value)} /></label>
              <Button type="button" className="min-h-10 font-bold uppercase" onClick={() => void analyze()} disabled={Boolean(busy) || !status.aiAvailable} data-testid="email-pedidos-analizar">
                {busy === "analizando" ? "Analizando…" : "Analizar correos"}
              </Button>
              <button type="button" className="min-h-10 text-xs underline" onClick={() => void disconnect()} disabled={Boolean(busy)} data-testid="email-pedidos-desconectar">Desconectar</button>
              <span className="text-[var(--os-text-muted)]">Conectada por {status.connectedBy}. Solo lectura: no borra, mueve ni responde correos.</span>
            </div>
          ) : null}
          {status && !status.aiAvailable ? <p className="text-xs text-amber-700">La lectura con IA no está disponible: {status.aiReason}</p> : null}
          {result ? (
            <p className="rounded border border-[var(--os-border)] px-2.5 py-1.5 text-xs" data-testid="email-pedidos-resultado">
              Revisados {result.requested} correo(s): {result.drafts} borrador(es) nuevo(s), {result.withoutOrder} sin pedido (consultas u otros), {result.alreadyProcessed} ya procesado(s)
              {result.errors.length ? `, ${result.errors.length} con error (se reintentan al analizar de nuevo)` : ""}.
              {result.errors.map((er) => <span key={er.messageId} className="block text-rose-700">«{er.subject || er.messageId}»: {er.message}</span>)}
            </p>
          ) : null}
          {status?.metrics && status.metrics.borradores > 0 ? (
            <p className="text-[11px] text-[var(--os-text-muted)]" data-testid="email-pedidos-metricas">
              Piloto: {status.metrics.borradores} borradores · {status.metrics.aprobadosSinCambios} aprobados sin correcciones · {status.metrics.aprobadosCorregidos} aprobados con correcciones · {status.metrics.descartados} descartados · {status.metrics.renglonesCargados} renglones cargados automáticamente.
            </p>
          ) : null}
          {pending.length === 0 && status?.connected ? <p className="text-xs text-[var(--os-text-muted)]">No hay borradores pendientes. Tocá «Analizar correos».</p> : null}
          <ul className="space-y-2">
            {pending.map((d) => (
              <DraftCard key={`${d.id}-${d.version}`} draft={d} api={api} disabled={Boolean(busy)} onChanged={async (created) => { await refresh(); if (created) onPedidosCreated(); }} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function DraftCard({ draft, api, disabled, onChanged }: { draft: DraftRow; api: <T>(path: string, init?: RequestInit) => Promise<T>; disabled: boolean; onChanged: (created: boolean) => Promise<void> }) {
  const [p, setP] = useState<DraftPayload>(draft.payload);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const isMod = draft.kind === "MODIFICACION";
  const set = (patch: Partial<DraftPayload>) => { setP((x) => ({ ...x, ...patch })); setDirty(true); };
  const setItem = (id: string, patch: Partial<DraftItem>) => { setP((x) => ({ ...x, items: x.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })); setDirty(true); };
  const url = `/api/v1/email-orders/drafts/${draft.id}`;
  async function act(name: string, body: Record<string, unknown>, created = false) {
    setBusy(name);
    setErr(null);
    try {
      if (dirty && name !== "descartar") {
        await api(url, { method: "POST", body: JSON.stringify({ action: "update", expectedVersion: draft.version, payload: p }) });
        setDirty(false);
      }
      if (name !== "guardar") await api(url, { method: "POST", body: JSON.stringify(body) });
      await onChanged(created);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo completar");
    } finally {
      setBusy(null);
    }
  }
  const allDoubts = [...p.doubts, ...p.items.flatMap((i, n) => i.doubts.map((d) => `Producto ${n + 1}: ${d}`))];
  return (
    <li className={`rounded border p-2 text-xs ${isMod ? "border-amber-500/60" : "border-[var(--os-border)]"}`} data-testid="email-borrador" data-kind={draft.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-sm">{p.cliente || "(cliente sin identificar)"}</b>
        <span className={`rounded px-1.5 py-0.5 ${isMod ? "bg-amber-500/20" : "bg-emerald-500/15"}`}>{isMod ? "POSIBLE MODIFICACIÓN" : "PEDIDO NUEVO"}</span>
        <span className="text-[var(--os-text-muted)]">Estado: pendiente de revisión</span>
      </div>
      <p className="mt-0.5 text-[var(--os-text-muted)]" data-testid="email-borrador-origen">
        Origen: {draft.source.from} · «{draft.source.subject}»{draft.source.attachments.length ? ` · Archivos: ${draft.source.attachments.map((a) => `${a.filename}${a.used ? "" : " (no leído)"}`).join(", ")}` : ""}
        {draft.source.links.length ? ` · ${draft.source.links.length} enlace(s) en el correo (no se abren)` : ""}
      </p>
      {isMod ? <p className="mt-1 rounded bg-amber-500/10 px-2 py-1" data-testid="email-borrador-modificacion">{draft.related.reason} No se modifica nada automáticamente: ajustá el pedido existente a mano y marcala como revisada, o creala como pedido nuevo.</p> : null}
      <div className="mt-1.5 grid gap-1.5 sm:grid-cols-4">
        <label>Cliente<input className={field} value={p.cliente} onChange={(e) => set({ cliente: e.target.value, clienteMatched: false })} data-testid="email-borrador-cliente" /></label>
        <label>N° de pedido / OC del cliente<input className={field} value={p.nroPedido} onChange={(e) => set({ nroPedido: e.target.value })} /></label>
        <label>Fecha solicitada<input type="date" className={field} value={p.fechaSolicitud} onChange={(e) => set({ fechaSolicitud: e.target.value })} /></label>
        <label>Entrega pedida<input type="date" className={field} value={p.fechaEntrega} onChange={(e) => set({ fechaEntrega: e.target.value })} /></label>
      </div>
      {!p.clienteMatched && p.clienteSuggestions.length ? (
        <p className="mt-1">Sugerencias de cliente: {p.clienteSuggestions.map((s) => <button key={s} type="button" className="mr-1 rounded-full border border-[var(--os-border)] px-2 py-0.5 underline" onClick={() => set({ cliente: s, clienteMatched: true })}>{s}</button>)}</p>
      ) : null}
      <div className="mt-1.5 space-y-1">
        {p.items.map((it, n) => (
          <div key={it.id} className={`grid items-end gap-1.5 sm:grid-cols-[auto_1fr_90px_110px] ${it.include ? "" : "opacity-50"}`} data-testid="email-borrador-item">
            <label className="flex items-center gap-1"><input type="checkbox" checked={it.include} onChange={(e) => setItem(it.id, { include: e.target.checked })} aria-label={`Incluir producto ${n + 1}`} /></label>
            <label>Producto<input className={`${field} ${it.doubts.length ? "border-amber-500" : ""}`} value={it.producto} onChange={(e) => setItem(it.id, { producto: e.target.value, productMatched: false })} disabled={Boolean(it.createdPedidoId)} />
              {it.productSuggestions.length && !it.productMatched ? <span className="block">{it.productSuggestions.map((s) => <button key={s} type="button" className="mr-1 mt-0.5 rounded-full border border-[var(--os-border)] px-2 py-0.5 underline" onClick={() => setItem(it.id, { producto: s, productMatched: true })}>{s}</button>)}</span> : null}
            </label>
            <label>Cantidad<input inputMode="decimal" className={`${field} ${it.cantidad == null ? "border-amber-500" : ""}`} value={it.cantidad ?? ""} onChange={(e) => setItem(it.id, { cantidad: e.target.value === "" ? null : Number(e.target.value.replace(",", ".")) || null })} /></label>
            <label>Presentación<input className={field} value={it.presentacion} onChange={(e) => setItem(it.id, { presentacion: e.target.value, ml: null })} /></label>
          </div>
        ))}
      </div>
      {allDoubts.length ? (
        <ul className="mt-1.5 list-disc rounded bg-amber-500/10 py-1 pl-6 pr-2" data-testid="email-borrador-dudas">{allDoubts.map((d, i) => <li key={i}>{d}</li>)}</ul>
      ) : null}
      {err ? <p className="mt-1 text-rose-700" role="alert" data-testid="email-borrador-error">{err}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {!isMod ? (
          <Button type="button" size="sm" className="min-h-10 font-bold uppercase" disabled={disabled || Boolean(busy) || draft.status !== "PENDIENTE"} onClick={() => void act("aprobar", { action: "approve" }, true)} data-testid="email-borrador-aprobar">{busy === "aprobar" ? "Creando…" : "Aprobar y crear pedido"}</Button>
        ) : (
          <>
            <Button type="button" size="sm" className="min-h-10" disabled={disabled || Boolean(busy)} onClick={() => void act("revisada", { action: "reviewed" })} data-testid="email-borrador-revisada">Marcar como revisada</Button>
            <Button type="button" size="sm" variant="secondary" className="min-h-10" disabled={disabled || Boolean(busy)} onClick={() => void act("nuevo", { action: "approve", asNew: true }, true)} data-testid="email-borrador-como-nuevo">Crear como pedido nuevo</Button>
          </>
        )}
        <Button type="button" size="sm" variant="secondary" className="min-h-10" disabled={disabled || Boolean(busy) || !dirty} onClick={() => void act("guardar", {})} data-testid="email-borrador-guardar">Guardar cambios</Button>
        <Button type="button" size="sm" variant="secondary" className="min-h-10" disabled={disabled || Boolean(busy)} onClick={() => { const r = window.prompt("Motivo del descarte (opcional):") ; if (r !== null) void act("descartar", { action: "discard", reason: r }); }} data-testid="email-borrador-descartar">Descartar</Button>
      </div>
    </li>
  );
}
