"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePreviewContext, usePreviewSession } from "@/features/os/session/preview-context";
import type { AlertDto } from "@/lib/me-control/service";
import { actorHeaders, fmtDate, fmtNum, meApi, setFocus } from "./me-control-client";

const REFRESH_MS = 15_000;

/**
 * Alertas de materiales de empaque para DEPÓSITO. Vienen de la base (persisten al recargar y entre dispositivos) y se
 * quedan fijas arriba de cualquier pantalla de Depósito hasta que alguien las cierra. Cerrar la notificación NO borra el
 * faltante ni marca nada como recibido: queda registrado quién y cuándo.
 */
export function MeControlAlertBanner() {
  const { email, sectorId } = usePreviewSession();
  const { navigateSidebar } = usePreviewContext();
  const isDeposito = String(sectorId).toUpperCase() === "DEPOSITO";
  const headers = useMemo(() => actorHeaders(email, sectorId), [email, sectorId]);
  const [alerts, setAlerts] = useState<AlertDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const body = await meApi<{ alerts: AlertDto[] }>("/alerts", headers);
      setAlerts(body.alerts);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las alertas de ME.");
    }
  }, [headers]);

  useEffect(() => {
    if (!isDeposito) return;
    const t0 = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), REFRESH_MS);
    const onVis = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("genus:me-control-changed", onVis);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("genus:me-control-changed", onVis);
    };
  }, [isDeposito, load]);

  if (!isDeposito || (alerts.length === 0 && !error)) return null;

  const close = async (a: AlertDto) => {
    setBusy(a.id);
    try {
      await meApi(`/alerts/${a.id}/close`, headers, { method: "POST", body: {} });
      setAlerts((cur) => cur.filter((x) => x.id !== a.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cerrar la notificación.");
    } finally {
      setBusy(null);
    }
  };
  const detail = (a: AlertDto) => {
    setFocus({ week: a.weekStart, client: a.client, product: a.product });
    navigateSidebar("control_me");
  };

  const MAX = 3;
  const shown = expanded ? alerts : alerts.slice(0, MAX);

  return (
    <section aria-label="Alertas de materiales de empaque" className="mb-4 space-y-3" data-testid="me-alert-banner">
      {error ? <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">{error}</p> : null}
      {shown.map((a) => {
        const confirmed = a.shortages.filter((s) => s.confirmation === "CONFIRMADO");
        const suggested = a.shortages.filter((s) => s.confirmation === "SUGERIDO");
        const units = a.totalQty;
        return (
          <article key={a.id} role="alert" className="rounded-lg border-2 border-rose-500 bg-rose-50 p-4 text-rose-950 shadow-sm dark:bg-rose-950/40 dark:text-rose-50" data-testid="me-alert" data-alert-key={a.alertKey}>
            <h3 className="text-base font-bold tracking-wide">⚠ {confirmed.length || suggested.length ? "FALTAN MATERIALES DE EMPAQUE" : "REVISAR MATERIALES DE EMPAQUE"}</h3>
            <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div><dt className="inline font-semibold">Cliente: </dt><dd className="inline">{a.client}</dd></div>
              <div><dt className="inline font-semibold">Producto: </dt><dd className="inline">{a.product}</dd></div>
              <div><dt className="inline font-semibold">Trabajo: </dt><dd className="inline">{units == null ? "cantidad sin definir" : `${fmtNum(units)} unidades`}{a.jobs.length > 1 ? ` (${a.jobs.length} trabajos)` : ""}</dd></div>
              <div><dt className="inline font-semibold">Semana: </dt><dd className="inline">{fmtDate(a.weekStart)}</dd></div>
            </dl>
            {confirmed.length > 0 ? (
              <div className="mt-3 text-sm" data-testid="me-alert-confirmed">
                <p className="font-bold">FALTAN:</p>
                <ul className="ml-5 list-disc">
                  {confirmed.map((s) => <li key={s.codigo}><strong>{fmtNum(s.faltante)}</strong> × {s.label} <span className="opacity-75">(necesario {fmtNum(s.needed)} · stock {fmtNum(s.stock)})</span></li>)}
                </ul>
              </div>
            ) : null}
            {suggested.length > 0 ? (
              <div className="mt-2 text-sm" data-testid="me-alert-suggested">
                <p className="font-semibold">Necesidades sugeridas por IA (sin confirmar):</p>
                <ul className="ml-5 list-disc">
                  {suggested.map((s) => <li key={s.codigo}>{fmtNum(s.faltante)} × {s.label}</li>)}
                </ul>
              </div>
            ) : null}
            {a.unidentified.length > 0 ? (
              <div className="mt-2 text-sm" data-testid="me-alert-unidentified">
                <p className="font-semibold">REVISAR — material sin identificar:</p>
                <ul className="ml-5 list-disc">
                  {a.unidentified.map((u) => <li key={u.role}>{a.product} {a.client}: {u.reason || `${u.label}.`}{u.estimated != null ? ` Necesidad estimada: ${fmtNum(u.estimated)} (falta identificar el material exacto).` : ""}</li>)}
                </ul>
              </div>
            ) : null}
            {a.sinAsociacion ? <p className="mt-2 text-sm font-semibold">REVISAR: {a.product} {a.client} — no tiene materiales de empaque asociados.</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="rounded bg-rose-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-800" onClick={() => detail(a)} data-testid="me-alert-detail">Ver detalle</button>
              <button type="button" className="rounded border border-rose-700 px-3 py-1.5 text-sm font-semibold text-rose-900 hover:bg-rose-100 disabled:opacity-60 dark:text-rose-50 dark:hover:bg-rose-900/40" disabled={busy === a.id} onClick={() => void close(a)} data-testid="me-alert-close">Cerrar notificación</button>
              {a.reopenCount > 0 ? <span className="self-center text-xs opacity-75">Reabierta por un cambio en el faltante</span> : null}
            </div>
          </article>
        );
      })}
      {alerts.length > MAX ? (
        <button type="button" className="text-sm font-semibold text-rose-800 underline dark:text-rose-200" onClick={() => setExpanded((v) => !v)} data-testid="me-alert-more">
          {expanded ? "Mostrar menos" : `Ver ${alerts.length - MAX} alerta${alerts.length - MAX === 1 ? "" : "s"} más`}
        </button>
      ) : null}
    </section>
  );
}
