"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { PushAdminOverview } from "@/lib/portal/push/push-service";

type Json = Record<string, unknown>;

async function api(body?: Json, view = "push"): Promise<{ ok: boolean; data: Json }> {
  const res = await fetch("/api/v1/portal-admin" + (body ? "" : `?view=${view}`), body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Json };
}
const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour12: false }) : "—");
const input = "w-20 rounded-lg border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm";

/**
 * Notificaciones push del Portal de Clientes — Administración, Producción y Dirección (`canManagePortal`; el servidor lo vuelve a validar).
 * Interruptor global de envío REAL (apagado por defecto: el worker solo registra eventos «simulados»), plazos estimados en días
 * hábiles y habilitación individual del piloto por cliente (al habilitar se registra el estado actual como ya notificado).
 */
export function PortalNotificacionesPanel() {
  const [data, setData] = useState<PushAdminOverview | null>(null);
  const [allowed, setAllowed] = useState(true);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState({ elaboracionDays: "8", envasadoDays: "3" });

  const daysLoaded = useRef(false);
  // Los plazos del formulario solo se pisan con los del servidor en la primera carga o tras guardar (nunca mientras se edita).
  const load = useCallback(async (resetDays = false) => {
    const r = await api();
    if (r.data.code === "FORBIDDEN") return setAllowed(false);
    if (!r.ok) return setMsg({ kind: "err", text: String(r.data.error ?? "No se pudo cargar la configuración de notificaciones.") });
    const d = r.data as unknown as PushAdminOverview;
    setData(d);
    if (!daysLoaded.current || resetDays) {
      daysLoaded.current = true;
      setDays({ elaboracionDays: String(d.settings.elaboracionDays), envasadoDays: String(d.settings.envasadoDays) });
    }
  }, []);
  useEffect(() => {
    // Carga inicial: el estado se actualiza al resolver la consulta.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function act(body: Json, okText: string, resetDays = false) {
    setBusy(true);
    try {
      const r = await api(body);
      setMsg(r.ok ? { kind: "ok", text: okText } : { kind: "err", text: String(r.data.error ?? "No se pudo completar la acción.") });
      if (r.ok) await load(resetDays);
    } finally {
      setBusy(false);
    }
  }

  // Prueba puntual a un cliente del piloto: no cambia el interruptor global ni toca pedidos. Muestra «aceptada por el servicio push» (HTTP 2xx) y,
  // aparte, «recepción comprobada en el dispositivo» (acuse del service worker), que se consulta unos segundos después.
  async function actTest(clientId: string, name: string) {
    setBusy(true);
    try {
      const r = await api({ action: "push_test", clientId });
      if (!r.ok) return setMsg({ kind: "err", text: String(r.data.error ?? "No se pudo enviar la notificación de prueba.") });
      const d = r.data as { sent?: number; failed?: number; devices?: number; testId?: string; error?: string | null };
      setMsg({ kind: "ok", text: `Notificación de prueba para ${name}: aceptada por el servicio push en ${d.sent ?? 0} de ${d.devices ?? 0} dispositivo(s)${d.failed ? `, ${d.failed} con error (${d.error ?? "sin detalle"})` : ""}. Esperando la recepción comprobada en el dispositivo…` });
      await load();
      for (let i = 0; i < 8 && d.testId && (d.sent ?? 0) > 0; i++) {
        await new Promise((res) => setTimeout(res, 2_500));
        const st = await fetch(`/api/v1/portal-admin?view=push_test_status&testId=${d.testId}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null) as { accepted?: number; received?: number } | null;
        if (st && (st.received ?? 0) > 0) {
          setMsg({ kind: "ok", text: `Notificación de prueba para ${name}: aceptada por el servicio push (${st.accepted ?? 0}) y recepción COMPROBADA en el dispositivo (${st.received}).` });
          await load();
          return;
        }
      }
      setMsg({ kind: "ok", text: `Notificación de prueba para ${name}: aceptada por el servicio push (${d.sent ?? 0}), pero todavía NO se comprobó la recepción en el dispositivo (puede estar apagado, sin conexión o con el permiso bloqueado).` });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!allowed || !data) return null;
  const q = data.queue;
  return (
    <section className="space-y-4 rounded-xl border border-[var(--os-border)] p-4" data-testid="portal-push-admin">
      <header className="space-y-1">
        <h3 className="font-semibold">Notificaciones push del portal (piloto)</h3>
        <p className="text-sm text-[var(--os-text-muted)]">
          Avisos automáticos al cliente (recibido, elaboración, envasado, listo, entregado). Con el envío real apagado el sistema solo registra eventos simulados y no envía nada. Cada cliente se habilita por separado; al habilitarlo, el estado actual de sus pedidos queda como ya notificado (sin avisos retroactivos).
        </p>
      </header>
      {msg ? <div role="status" className={`rounded-lg px-3 py-2 text-sm ${msg.kind === "ok" ? "bg-emerald-500/10 text-emerald-700" : "bg-red-500/10 text-red-700"}`}>{msg.text}</div> : null}

      <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="push-global">
        <span className={`rounded-full px-3 py-1 font-semibold ${data.settings.globalSendEnabled ? "bg-emerald-500/15 text-emerald-700" : "bg-amber-500/15 text-amber-700"}`} data-testid="push-global-state">
          Envío real: {data.settings.globalSendEnabled ? "ENCENDIDO" : "APAGADO (simulado)"}
        </span>
        <Button type="button" disabled={busy} variant="secondary" data-testid="push-global-toggle"
          onClick={() => {
            if (!data.settings.globalSendEnabled && !window.confirm("Se van a enviar notificaciones REALES a los clientes habilitados en el piloto. ¿Encender el envío real?")) return;
            void act({ action: "push_settings", globalSendEnabled: !data.settings.globalSendEnabled }, data.settings.globalSendEnabled ? "Envío real apagado." : "Envío real encendido.");
          }}>
          {data.settings.globalSendEnabled ? "Apagar envío real" : "Encender envío real"}
        </Button>
        <span className="text-[var(--os-text-muted)]">Claves VAPID: {data.vapidConfigured ? "configuradas" : "FALTAN (no se puede enviar)"} · Cron: {data.cronConfigured ? "configurado" : "FALTA CRON_SECRET"}</span>
      </div>

      <div className="rounded-lg border border-[var(--os-border)] p-3 text-sm" data-testid="push-worker">
        <b>Última ejecución del worker:</b> {fmt(data.worker.lastFinishedAt)} ({data.worker.lastTrigger ?? "nunca ejecutado"}) ·{" "}
        <span data-testid="push-worker-state" className={data.worker.lastOk === false ? "text-red-700" : ""}>{data.worker.lastOk == null ? "sin datos" : data.worker.lastOk ? "OK" : `ERROR: ${data.worker.lastError ?? ""}`}</span>
        {" "}· Último cron: {fmt(data.worker.lastCronAt)} · Corridas: {data.worker.runsTotal}
        {data.cronStale ? <div className="text-amber-700" data-testid="push-cron-stale">{data.worker.lastCronAt == null ? "Sin ejecuciones recientes: el cron todavía no corrió. Revisá CRON_SECRET y el cron «/api/cron/portal-push» en Vercel." : "Sin ejecuciones recientes del cron (pasaron más de 5 minutos). Revisá el cron «/api/cron/portal-push» en Vercel."}</div> : null}
        {data.worker.lastCronOk === false ? <div className="text-red-700">La última corrida del cron falló: {data.worker.lastCronError}</div> : null}
      </div>

      <div className="flex flex-wrap items-end gap-3 text-sm" data-testid="push-days">
        <label className="space-y-1">Elaboración: días hábiles estimados<br /><input className={input} inputMode="numeric" value={days.elaboracionDays} onChange={(e) => setDays({ ...days, elaboracionDays: e.target.value })} data-testid="push-days-elab" /></label>
        <label className="space-y-1">Envasado: días hábiles estimados<br /><input className={input} inputMode="numeric" value={days.envasadoDays} onChange={(e) => setDays({ ...days, envasadoDays: e.target.value })} data-testid="push-days-env" /></label>
        <Button type="button" disabled={busy} data-testid="push-days-save" onClick={() => void act({ action: "push_settings", elaboracionDays: Number(days.elaboracionDays), envasadoDays: Number(days.envasadoDays) }, "Plazos guardados.", true)}>Guardar plazos</Button>
        <span className="text-xs text-[var(--os-text-muted)]">Se informan al cliente como estimaciones («aproximadamente N días hábiles»).</span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5" data-testid="push-queue">
        <div className="rounded-lg border border-[var(--os-border)] p-2">Pendientes<br /><b data-testid="q-pend">{q.pendientes}</b></div>
        <div className="rounded-lg border border-[var(--os-border)] p-2">Enviadas<br /><b data-testid="q-env">{q.enviadas}</b></div>
        <div className="rounded-lg border border-[var(--os-border)] p-2">Fallidas<br /><b data-testid="q-fail">{q.fallidas}</b></div>
        <div className="rounded-lg border border-[var(--os-border)] p-2">Simuladas<br /><b data-testid="q-sim">{q.simuladas}</b></div>
        <div className="rounded-lg border border-[var(--os-border)] p-2">Sin dispositivos<br /><b>{q.sinDispositivos}</b></div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="push-clients">
          <thead><tr className="text-left text-[var(--os-text-muted)]"><th className="py-1 pr-3">Cliente con acceso al portal</th><th className="pr-3">Usuarios</th><th className="pr-3">Dispositivos</th><th className="pr-3">Última suscripción</th><th className="pr-3">Última enviada</th><th className="pr-3">Eventos (pend/sim/env/fall)</th><th className="pr-3">Último fallo</th><th className="pr-3">Entregas (aceptadas / recibidas / error)</th><th className="pr-3">Piloto de notificaciones</th><th className="pr-3">Envío real a este cliente</th><th className="pr-3">Prueba</th></tr></thead>
          <tbody>
            {data.clients.map((c) => (
              <tr key={c.id} className="border-t border-[var(--os-border)]" data-testid="push-client-row">
                <td className="py-2 pr-3">{c.name} <span className="text-[var(--os-text-muted)]">({c.code})</span></td>
                <td className="pr-3">{c.users}</td>
                <td className="pr-3" data-testid="push-diag-devices">{c.devices}{c.deviceErrors ? ` (${c.deviceErrors} con error)` : ""}</td>
                <td className="pr-3">{fmt(c.lastSubscriptionAt)}</td>
                <td className="pr-3">{fmt(c.lastSentAt)}</td>
                <td className="pr-3" data-testid="push-diag-events">{c.events.pendientes}/{c.events.simulados}/{c.events.enviados}/{c.events.fallidos}{c.events.sinDispositivos ? ` · ${c.events.sinDispositivos} sin dispositivos` : ""}</td>
                <td className="pr-3 text-xs">{c.lastFailure ? `${c.lastFailure.reason} (${fmt(c.lastFailure.at)})` : "—"}</td>
                <td className="pr-3 text-xs" data-testid="push-diag-deliveries">{c.deliveries.aceptadas} aceptadas por el servicio push / {c.deliveries.recibidas} recepción comprobada / {c.deliveries.errores} con error</td>
                <td className="pr-3">
                  <label className="inline-flex items-center gap-2">
                    <input type="checkbox" checked={c.pilotEnabled} disabled={busy} data-testid="push-pilot-toggle"
                      onChange={(e) => void act({ action: "push_pilot", clientId: c.id, enabled: e.target.checked }, e.target.checked ? `Piloto habilitado para ${c.name}: se registró el estado actual de sus pedidos sin enviar avisos.` : `Piloto deshabilitado para ${c.name}.`)} />
                    {c.pilotEnabled ? `Habilitado${c.baselineAt ? ` · base ${c.baselineOrders} pedidos` : ""}` : "No habilitado"}
                  </label>
                </td>
                <td className="pr-3">
                  {c.pilotEnabled ? (
                    <label className="inline-flex items-center gap-2" title="Envía notificaciones REALES solo a este cliente, aunque el envío real global siga apagado.">
                      <input type="checkbox" checked={c.realSendEnabled} disabled={busy} data-testid="push-real-toggle"
                        onChange={(e) => {
                          const on = e.target.checked;
                          if (on && !window.confirm(`Se enviarán notificaciones REALES a los dispositivos de ${c.name}, aunque el envío real global esté apagado. El resto de los clientes NO se ve afectado. ¿Habilitar el envío REAL a este cliente (prueba)?`)) return;
                          void act({ action: "push_real_send", clientId: c.id, enabled: on, confirm: on }, on ? `Envío REAL habilitado solo para ${c.name}.` : `Envío real deshabilitado para ${c.name} (vuelve a simulado).`);
                        }} />
                      <span data-testid="push-real-state" className={c.realSendEnabled ? "font-semibold text-emerald-700" : "text-amber-700"}>{c.realSendEnabled ? "Envío REAL a este cliente (prueba)" : data.settings.globalSendEnabled ? "Real (global)" : "SIMULADO"}</span>
                    </label>
                  ) : null}
                </td>
                <td className="pr-3">
                  {c.pilotEnabled ? (
                    <Button type="button" variant="secondary" disabled={busy} data-testid="push-test-send"
                      onClick={() => {
                        if (!window.confirm(`Se enviará una notificación REAL de prueba a los ${c.devices} dispositivo(s) suscripto(s) de ${c.name}. ¿Enviar?`)) return;
                        void actTest(c.id, c.name);
                      }}>
                      Enviar notificación de prueba
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
            {data.clients.map((c) => (c.devicesList.length || c.recentEvents.length) ? (
              <tr key={`${c.id}-detail`} data-testid="push-client-detail">
                <td colSpan={11} className="pb-3 text-xs text-[var(--os-text-muted)]">
                  <div><b>{c.name} — dispositivos:</b> {c.devicesList.length === 0 ? "ninguno" : c.devicesList.map((d) => `${d.userAgent?.slice(0, 40) ?? "dispositivo"} · ${d.valid ? "suscripción válida" : `INVÁLIDA (${d.invalidReason})`} · verificado ${fmt(d.lastVerifiedAt)}${d.lastError ? ` · error: ${d.lastError}` : ""}`).join("  |  ")}</div>
                  <div><b>Últimos eventos:</b> {c.recentEvents.length === 0 ? "ninguno" : c.recentEvents.map((e) => `${e.type}${e.orderRef ? ` (${e.orderRef})` : ""}: ${e.status === "SIMULADA" ? "SIMULADO (no se envió)" : e.status === "ENVIADA" ? `ENVIADO · aceptado por el servicio push ${e.accepted} · recepción comprobada ${e.received}` : e.status}${e.error && e.status !== "ENVIADA" && e.status !== "SIMULADA" ? ` — ${e.error}` : ""}`).join("  |  ")}</div>
                </td>
              </tr>
            ) : null)}
            {data.clients.length === 0 ? <tr><td colSpan={11} className="py-2 text-[var(--os-text-muted)]">No hay clientes con acceso al portal.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
