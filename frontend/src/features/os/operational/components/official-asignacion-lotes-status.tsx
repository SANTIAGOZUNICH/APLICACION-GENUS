"use client";

import { useEffect, useState } from "react";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import {
  fetchOfficialAsignacionLotesStatusApi,
  type OfficialAsignacionLotesStatus,
} from "@/lib/asignacion-lotes/asignacion-lote-sources-client";

function relativeTime(iso: string | null): string {
  if (!iso) return "nunca";
  const diffMs = Date.now() - new Date(iso).getTime();
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 5) return "recién";
  if (seconds < 60) return `hace ${seconds} seg`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return new Date(iso).toLocaleString("es-AR");
}

/** Próxima corrida aproximada del cron — solo informativo (Vercel Cron no expone la próxima hora exacta). */
function approxNextSync(lastSyncAt: string | null, frequencyMinutes: number): string {
  if (!lastSyncAt) return "en los próximos minutos";
  const next = new Date(new Date(lastSyncAt).getTime() + frequencyMinutes * 60_000);
  return next.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Estado simple de las dos fuentes OFICIALES de Asignación de Lotes
 * (2025/2026, ver official-sources.ts) — sección 12 del pedido: visible
 * para CUALQUIER sector con acceso al módulo (Calidad/Producción/
 * Codificado), no solo quienes pueden configurar fuentes. Solo lectura —
 * la sincronización real la hace el cron cada 10 minutos, server-side, sin
 * que nadie tenga que tocar nada acá. "Sincronizar ahora" sigue existiendo
 * como respaldo manual en la pantalla avanzada de fuentes (Producción/
 * Dirección).
 */
export function OfficialAsignacionLotesStatusBanner({ session }: { session: OrdersClientSession }) {
  const [status, setStatus] = useState<OfficialAsignacionLotesStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchOfficialAsignacionLotesStatusApi(session)
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "No se pudo cargar el estado.");
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (error) return null; // best-effort — nunca bloquea el resto de la pantalla
  if (!status) return null;

  const allOk = status.sources.every((s) => s.connected && s.enabled && s.syncStatus !== "error");
  const anyError = status.sources.some((s) => s.syncStatus === "error");

  return (
    <div
      data-testid="official-asignacion-lotes-status"
      className="rounded-[var(--os-radius-md)] border border-[var(--os-border)] bg-[var(--os-surface)] p-4"
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span>{anyError ? "🔴" : allOk ? "🟢" : "⚪"}</span>
        <span>
          {anyError
            ? "Error de sincronización en alguna fuente oficial"
            : allOk
              ? "Google Sheets conectado — sincronización automática activa"
              : "Sincronización oficial pendiente de la primera corrida"}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {status.sources.map((source) => (
          <div
            key={source.spreadsheetId}
            data-testid={`official-asignacion-lotes-status-${source.year}`}
            className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 py-2 text-xs"
          >
            <p className="font-medium text-[var(--os-text)]">
              {source.year}{" "}
              {source.syncStatus === "error"
                ? "🔴"
                : source.connected && source.enabled
                  ? "✓ sincronizado"
                  : "⚪ pendiente"}
            </p>
            <p className="mt-1 text-[var(--os-text-muted)]">
              Última actualización: {relativeTime(source.lastSuccessfulSyncAt ?? source.lastSyncAt)}
            </p>
            {source.lastRun ? (
              <p className="mt-1 text-[var(--os-text-muted)]">
                {source.lastRun.sheetsTotal != null
                  ? `${source.lastRun.sheetsTotal} hoja(s) detectada(s)${
                      source.lastRun.ignoredTabsCount > 0
                        ? ` · ${source.lastRun.ignoredTabsCount} ignorada(s)`
                        : ""
                    } · `
                  : ""}
                {source.lastRun.rowsRead} fila(s) procesada(s)
              </p>
            ) : null}
            {source.syncStatus === "error" && source.lastError ? (
              <p className="mt-1 text-[var(--genus-error,#e85d5d)]">{source.lastError}</p>
            ) : null}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-[var(--os-text-muted)]">
        Actualización automática: cada {status.syncFrequencyMinutes} min
        {status.sources[0]?.lastSyncAt
          ? ` · próxima aprox. ${approxNextSync(status.sources[0].lastSyncAt, status.syncFrequencyMinutes)}`
          : ""}
      </p>
    </div>
  );
}
