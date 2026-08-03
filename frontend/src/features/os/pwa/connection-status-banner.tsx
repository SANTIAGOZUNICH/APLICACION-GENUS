"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getConnectionStatus,
  startConnectionMonitor,
  subscribeConnectionStatus,
  type ConnectionStatus,
} from "@/lib/pwa/connection-monitor";

const LABELS: Record<ConnectionStatus, string> = {
  CONNECTED: "Conectado",
  RECONNECTING: "Reconectando…",
  SIN_CONEXION: "Sin conexión",
  SERVIDOR_NO_DISPONIBLE: "Servidor no disponible",
  SESION_VENCIDA: "Sesión vencida",
};

const HINTS: Record<ConnectionStatus, string> = {
  CONNECTED: "",
  RECONNECTING: "Comprobando el servidor…",
  SIN_CONEXION: "No se pueden guardar cambios hasta recuperar internet.",
  SERVIDOR_NO_DISPONIBLE: "Hay red, pero Genus OS no responde. Reintentá en unos segundos.",
  SESION_VENCIDA: "Volvé a iniciar sesión para continuar.",
};

export function ConnectionStatusBanner() {
  const [status, setStatus] = useState<ConnectionStatus>(() =>
    typeof window === "undefined" ? "CONNECTED" : getConnectionStatus()
  );

  useEffect(() => {
    const stop = startConnectionMonitor();
    const unsub = subscribeConnectionStatus(setStatus);
    return () => {
      stop();
      unsub();
    };
  }, []);

  const visible = status !== "CONNECTED";
  const tone = useMemo(() => {
    if (status === "RECONNECTING") return "border-amber-500/40 bg-amber-500/10 text-amber-100";
    if (status === "SESION_VENCIDA") return "border-rose-500/40 bg-rose-500/10 text-rose-100";
    return "border-[var(--os-border)] bg-[var(--os-navy)]/90 text-[var(--os-text)]";
  }, [status]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`sticky top-0 z-[var(--os-z-banner,45)] border-b px-3 py-2 text-center text-xs sm:text-sm ${tone}`}
      style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top, 0px))" }}
    >
      <strong className="font-semibold">{LABELS[status]}</strong>
      {HINTS[status] ? <span className="ml-1 opacity-90">· {HINTS[status]}</span> : null}
      {status === "SESION_VENCIDA" ? (
        <a href="/login" className="ml-2 underline underline-offset-2">
          Ingresar
        </a>
      ) : (
        <button
          type="button"
          className="ml-2 min-h-9 rounded px-2 underline underline-offset-2"
          onClick={() => window.location.reload()}
        >
          Reintentar
        </button>
      )}
    </div>
  );
}
