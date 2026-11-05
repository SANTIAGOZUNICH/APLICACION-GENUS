"use client";

/**
 * Pedidos recibidos por email (PILOTO) — sección compacta dentro de Pedidos. «Buscar pedidos nuevos» (y la revisión automática cada 15 min) lee hasta 10 correos nuevos de la casilla de pedidos,
 * la IA los interpreta y quedan BORRADORES pendientes: nada se crea hasta que Producción aprueba. Ver docss/PEDIDOS_EMAIL_GMAIL.md.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import type { DraftRow, AnalyzeResult } from "@/lib/email-orders/service";
import type { DraftItem, DraftPayload } from "@/lib/email-orders/types";
import { RUN_STATUS_LABEL, type RunStatus } from "@/lib/email-orders/sync";

type LastRun = {
  id: string; trigger: string; actor: string | null; startedAt: string; finishedAt: string | null; windowDays: number | null; status: RunStatus | "en_curso"; reason: string | null; account: string | null;
  found: number; scanned: number; analyzed: number; drafts: number; omitted: number; excluded: number; withoutOrder: number; alreadyProcessed: number; errors: number;
  errorItems: Array<{ messageId: string; subject: string; message: string }>;
};
type RecentMessage = { id: string; outcome: string; reason: string | null; receivedAt: string | null; analyzedAt: string; from: string | null; subject: string | null };
type Probe = { ok: boolean; account: string; inboxSample: number | null; message: string; reconnect: boolean };
const fmtDateTime = (iso: string | null) => (iso ? new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "—");
const TRIGGER_LABEL: Record<string, string> = { manual: "manual", cron: "automática", backfill: "recuperación de correos anteriores" };
const OUTCOME_LABEL: Record<string, string> = { borrador: "Borrador creado", sin_pedido: "Omitido (no es un pedido)", excluido: "Omitido (no iba a pedidos@)", error: "Con error", procesando: "Procesando" };

type Status = {
  account: string;
  ordersAddress?: string;
  oauth: { ready: boolean; missing: string[]; invalid: Array<{ name: string; problem: string }>; keyFormat: string | null };
  aiAvailable: boolean;
  aiReason: string;
  dbReady: boolean;
  connected: boolean;
  connectedAt: string | null;
  connectedBy: string | null;
  lastError: string | null;
  lastAnalyzedAt: string | null;
  lastRun?: LastRun | null;
  recent?: RecentMessage[];
  automatic?: { everyMinutes: number; windowDays: number };
  metrics: { mensajes: number; sinPedido: number; conError: number; excluidos?: number; borradores: number; pendientes: number; aprobados: number; aprobadosSinCambios: number; aprobadosCorregidos: number; descartados: number; renglonesCargados: number } | null;
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
  const [windowDays, setWindowDays] = useState("");
  const [recheck, setRecheck] = useState(false);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [gem, setGem] = useState<null | { ok: boolean; message: string; effectiveModel: string | null; listing: { ok: boolean; status: number | null; count: number }; text: { ok: boolean; kind?: string; message: string }; image: null | { ok: boolean; kind?: string; message: string }; attempts: Array<{ model: string; status: number | null; kind: string; reason?: string }> }>(null);
  const [diag, setDiag] = useState<null | { target: string; scanned: number; verified: number; rows: Array<{ date: string | null; senderDomain: string; verified: boolean; strength: string | null; evidence: string[]; reason: string; recipientHeadersPresent: string[] }> }>(null);

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
      const r = await api<{ result: AnalyzeResult }>("/api/v1/email-orders/analyze", { method: "POST", body: JSON.stringify({ max, afterDate: after || undefined, beforeDate: before || undefined, windowDays: windowDays ? Number(windowDays) : undefined, recheckExcluded: recheck || undefined }) });
      setResult(r.result);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo analizar");
    } finally {
      setBusy(null);
    }
  }
  async function checkConnection() {
    setBusy("verificando-conexion");
    setError(null);
    try {
      setProbe(await api<Probe>("/api/v1/email-orders/probe", { method: "POST", body: "{}" }));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo verificar la conexión");
    } finally {
      setBusy(null);
    }
  }
  async function probeGemini() {
    setBusy("probando-gemini");
    setError(null);
    try {
      setGem((await api<{ health: NonNullable<typeof gem> }>("/api/v1/inventory/receipts?module=MP&view=extraction_health&image=1")).health);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo probar Gemini");
    } finally {
      setBusy(null);
    }
  }
  async function runDiagnose() {
    setBusy("diagnosticando");
    setError(null);
    try {
      setDiag(await api("/api/v1/email-orders/diagnose", { method: "POST", body: JSON.stringify({ scan: 20 }) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo verificar el filtro");
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
          {status?.connected ? (
            <div className="rounded border border-[var(--os-border)] px-2.5 py-1.5 text-xs" data-testid="email-pedidos-estado">
              <p>Cuenta conectada: <b>{status.account}</b>{status.connectedAt ? ` (desde ${fmtDateTime(status.connectedAt)}, por ${status.connectedBy ?? "—"})` : ""} · Recibe pedidos para <b>{status.ordersAddress ?? "pedidos@laboratoriogenus.com.ar"}</b>.</p>
              {status.automatic ? <p className="text-[var(--os-text-muted)]">Revisión automática de Gmail cada {status.automatic.everyMinutes} min (correos de los últimos {status.automatic.windowDays} días), además del botón. Solo lectura: no borra, no mueve y no responde correos.</p> : null}
              {probe ? (
                <p className={probe.ok ? "text-emerald-700" : "text-rose-700"} role={probe.ok ? "status" : "alert"} data-testid="email-pedidos-conexion">{probe.ok ? "✔ " : "✖ "}{probe.message}</p>
              ) : status.lastError ? (
                <p className="text-rose-700" data-testid="email-pedidos-ultimo-error">Último problema: {status.lastError}</p>
              ) : null}
              {status.lastRun ? (
                <div className="mt-1" data-testid="email-pedidos-ultima-sync">
                  <p>
                    <b>Última sincronización: {fmtDateTime(status.lastRun.startedAt)}</b> ({TRIGGER_LABEL[status.lastRun.trigger] ?? status.lastRun.trigger}{status.lastRun.windowDays ? `, últimos ${status.lastRun.windowDays} días` : ""}) ·{" "}
                    <span className={status.lastRun.status === "ok" ? "text-emerald-700" : status.lastRun.status === "sin_borradores" || status.lastRun.status === "sin_correos" ? "text-amber-700" : "text-rose-700"}>{status.lastRun.status === "en_curso" ? "En curso" : RUN_STATUS_LABEL[status.lastRun.status as RunStatus] ?? status.lastRun.status}</span>
                  </p>
                  <p data-testid="email-pedidos-contadores">Correos encontrados: {status.lastRun.found} · Analizados: {status.lastRun.analyzed} · Borradores creados: {status.lastRun.drafts} · Omitidos: {status.lastRun.omitted} · Ya procesados: {status.lastRun.alreadyProcessed} · Con error: {status.lastRun.errors}</p>
                  {status.lastRun.reason ? <p className="text-[var(--os-text-muted)]" data-testid="email-pedidos-motivo">{status.lastRun.reason}</p> : null}
                </div>
              ) : <p className="mt-1 text-amber-700" data-testid="email-pedidos-sin-sync">Todavía no se hizo ninguna sincronización: tocá «Buscar pedidos nuevos» (o esperá la revisión automática).</p>}
            </div>
          ) : null}

          {status && !status.oauth.ready ? (
            <p className="rounded border border-amber-400/60 bg-amber-400/10 px-2.5 py-1.5 text-xs" data-testid="email-pedidos-config">
              {status.oauth.missing.length ? <>No llegan al servidor (revisá el entorno Production y hacé un redeploy después de crearlas): {status.oauth.missing.join(", ")}. </> : null}
              {status.oauth.invalid.length ? <>Mal configuradas: {status.oauth.invalid.map((i) => `${i.name} (${i.problem === "demasiado_corta" ? "demasiado corta, mínimo 32 caracteres" : "vacía"})`).join(", ")}. </> : null}
              Ver docss/PEDIDOS_EMAIL_GMAIL.md.
            </p>
          ) : null}
          {status && !status.connected && status.oauth.ready ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span>Cuenta a conectar: <b>{status.account}</b> (a donde Webnode reenvía). Solo se analizan los correos que originalmente iban a <b>{status.ordersAddress ?? "pedidos@laboratoriogenus.com.ar"}</b>. Se pide solo permiso de LECTURA de Gmail.</span>
              <a className="inline-flex min-h-10 items-center rounded bg-[var(--os-teal,#0d9488)] px-3 text-sm font-semibold text-white" href="/api/v1/email-orders/oauth/start" data-testid="email-pedidos-conectar">Conectar casilla de pedidos</a>
            </div>
          ) : null}
          {status?.connected ? (
            <div className="flex flex-wrap items-end gap-2 text-xs">
              <label>Buscar en
                <select className={`${field} min-h-10`} value={windowDays} onChange={(e) => setWindowDays(e.target.value)} data-testid="email-pedidos-ventana">
                  <option value="">Correos recientes</option>
                  <option value="7">Últimos 7 días</option>
                  <option value="15">Últimos 15 días</option>
                  <option value="30">Últimos 30 días</option>
                </select>
              </label>
              <label>Máx. por búsqueda
                <select className={`${field} min-h-10`} value={max} onChange={(e) => setMax(Number(e.target.value))} data-testid="email-pedidos-max">
                  {[3, 5, 10].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label>Desde<input type="date" className={`${field} min-h-10`} value={after} onChange={(e) => setAfter(e.target.value)} /></label>
              <label>Hasta<input type="date" className={`${field} min-h-10`} value={before} onChange={(e) => setBefore(e.target.value)} /></label>
              <label className="flex min-h-10 items-center gap-1"><input type="checkbox" checked={recheck} onChange={(e) => setRecheck(e.target.checked)} />Volver a revisar los excluidos</label>
              <Button type="button" className="min-h-10 font-bold" onClick={() => void analyze()} disabled={Boolean(busy) || !status.aiAvailable} data-testid="email-pedidos-analizar">
                {busy === "analizando" ? "Buscando…" : "Buscar pedidos nuevos"}
              </Button>
              <button type="button" className="min-h-10 text-xs underline" onClick={() => void checkConnection()} disabled={Boolean(busy)} data-testid="email-pedidos-verificar-conexion">{busy === "verificando-conexion" ? "Verificando…" : "Verificar conexión con Gmail"}</button>
              <button type="button" className="min-h-10 text-xs underline" onClick={() => void probeGemini()} disabled={Boolean(busy)} data-testid="email-pedidos-probar-gemini">{busy === "probando-gemini" ? "Probando…" : "Probar Gemini"}</button>
              <button type="button" className="min-h-10 text-xs underline" onClick={() => void runDiagnose()} disabled={Boolean(busy)} data-testid="email-pedidos-diagnosticar">{busy === "diagnosticando" ? "Verificando…" : "Verificar filtro (sin analizar)"}</button>
              <button type="button" className="min-h-10 text-xs underline" onClick={() => void disconnect()} disabled={Boolean(busy)} data-testid="email-pedidos-desconectar">Desconectar</button>
              <span className="text-[var(--os-text-muted)]">Conectada por {status.connectedBy}. Solo lectura: no borra, mueve ni responde correos.</span>
            </div>
          ) : null}
          {status && !status.aiAvailable ? <p className="text-xs text-amber-700">La lectura con IA no está disponible: {status.aiReason}</p> : null}
          {gem ? (
            <div className={`rounded border px-2.5 py-1.5 text-xs ${gem.ok ? "border-emerald-400/60" : "border-rose-500/60"}`} data-testid="email-pedidos-gemini">
              <p><b>{gem.ok ? "Gemini responde correctamente" : "Gemini falló"}</b>{gem.effectiveModel ? ` · modelo ${gem.effectiveModel}` : ""} · listado de modelos: {gem.listing.ok ? `OK (${gem.listing.count})` : `falló (HTTP ${gem.listing.status ?? "?"})`} · texto: {gem.text.ok ? "OK" : "falló"} · imagen: {gem.image ? (gem.image.ok ? "OK" : "falló") : "no probada"}</p>
              {!gem.ok ? <p className="mt-0.5">{gem.image && !gem.image.ok ? gem.image.message : gem.text.message}</p> : null}
              {gem.attempts.length ? <p className="mt-0.5 text-[var(--os-text-muted)]">Intentos: {gem.attempts.map((a) => `${a.model} → ${a.kind}${a.status ? ` (HTTP ${a.status}${a.reason ? ` · ${a.reason}` : ""})` : ""}`).join("; ")}</p> : null}
            </div>
          ) : null}
          {diag ? (
            <div className="rounded border border-[var(--os-border)] px-2.5 py-1.5 text-xs" data-testid="email-pedidos-diagnostico">
              <p>Filtro de destinatario original ({diag.target}): de {diag.scanned} correos recientes, <b>{diag.verified}</b> verificados y {diag.scanned - diag.verified} excluidos. Solo se muestran metadatos; nada se descargó ni se envió a la IA.</p>
              <ul className="mt-1 space-y-0.5">
                {diag.rows.map((r, i) => (
                  <li key={i}>{(r.date ?? "").slice(0, 10)} · {r.senderDomain || "?"} · {r.verified ? `✔ verificado (${r.strength}: ${r.evidence.join(", ")})` : `✖ no verificable (${r.reason === "sin_encabezados" ? "sin encabezados" : "sin destinatario original"}; encabezados de destinatario presentes: ${r.recipientHeadersPresent.join(", ") || "ninguno"})`}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {result ? (
            <div className={`rounded border px-2.5 py-1.5 text-xs ${result.status === "ok" ? "border-emerald-400/60" : result.status === "parcial" ? "border-amber-400/60" : "border-amber-500/60"}`} data-testid="email-pedidos-resultado" data-status={result.status}>
              <p><b>{RUN_STATUS_LABEL[result.status]}</b> · Encontrados {result.found} · Analizados {result.analyzed} · Borradores creados {result.drafts} · Omitidos {result.omitted} · Ya procesados {result.alreadyProcessed} · Con error {result.errors.length}</p>
              <p className="text-[var(--os-text-muted)]">{result.reason}</p>
              {result.errors.map((er) => <span key={er.messageId} className="block text-rose-700">«{er.subject || er.messageId}»: {er.message} (se reintenta al volver a buscar)</span>)}
            </div>
          ) : null}
          {status?.recent?.length ? (
            <details className="rounded border border-[var(--os-border)] px-2.5 py-1.5 text-xs" data-testid="email-pedidos-recientes">
              <summary className="cursor-pointer font-medium">Últimos correos revisados ({status.recent.length})</summary>
              <ul className="mt-1 space-y-0.5">
                {status.recent.map((m) => (
                  <li key={m.id} className={m.outcome === "error" ? "text-rose-700" : ""} data-outcome={m.outcome}>
                    {fmtDateTime(m.receivedAt ?? m.analyzedAt)} · {OUTCOME_LABEL[m.outcome] ?? m.outcome}{m.from ? ` · ${m.from}` : ""}{m.subject ? ` · «${m.subject}»` : ""}{m.reason ? ` — ${m.reason}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {status?.metrics && status.metrics.borradores > 0 ? (
            <p className="text-[11px] text-[var(--os-text-muted)]" data-testid="email-pedidos-metricas">
              Piloto: {status.metrics.borradores} borradores · {status.metrics.aprobadosSinCambios} aprobados sin correcciones · {status.metrics.aprobadosCorregidos} aprobados con correcciones · {status.metrics.descartados} descartados · {status.metrics.renglonesCargados} renglones cargados automáticamente.
            </p>
          ) : null}
          {pending.length === 0 && status?.connected ? <p className="text-xs text-[var(--os-text-muted)]">No hay borradores pendientes. Tocá «Buscar pedidos nuevos».</p> : null}
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
        {draft.payload.confidence ? <span className={`rounded px-1.5 py-0.5 ${draft.payload.confidence === "alta" ? "bg-emerald-500/15" : "bg-amber-500/20"}`} data-testid="email-borrador-confianza">Interpretación: confianza {draft.payload.confidence}{draft.payload.uncertain ? " · A REVISAR (no es seguro que sea un pedido)" : ""}</span> : null}
      </div>
      <p className="mt-0.5 text-[var(--os-text-muted)]" data-testid="email-borrador-origen">
        Origen: {draft.source.from} · {fmtDateTime(draft.source.receivedAt)} · «{draft.source.subject}»{draft.source.attachments.length ? ` · Archivos: ${draft.source.attachments.map((a) => `${a.filename}${a.used ? "" : " (no leído)"}`).join(", ")}` : ""}
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
