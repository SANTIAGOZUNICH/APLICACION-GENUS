/**
 * Estado de conectividad Genus OS.
 * Combina navigator.onLine + ping real a /api/v1/connectivity (+ auth/me opcional).
 */

import { resolveSessionAuthoritatively } from "@/lib/auth/session-authority";

export type ConnectionStatus =
  | "CONNECTED"
  | "RECONNECTING"
  | "SIN_CONEXION"
  | "SERVIDOR_NO_DISPONIBLE"
  | "SESION_VENCIDA";

type Listener = (status: ConnectionStatus) => void;

const listeners = new Set<Listener>();
let status: ConnectionStatus = "CONNECTED";
let timer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = 4000;
let hiddenPaused = false;
let started = false;

function emit(next: ConnectionStatus) {
  if (status === next) return;
  status = next;
  for (const listener of listeners) listener(status);
}

export function getConnectionStatus(): ConnectionStatus {
  return status;
}

export function subscribeConnectionStatus(listener: Listener): () => void {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
}

async function pingConnectivity(): Promise<"ok" | "offline" | "server"> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "offline";
  }
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 6000);
    const res = await fetch("/api/v1/connectivity", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    clearTimeout(t);
    if (res.ok) return "ok";
    return "server";
  } catch {
    return typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "server";
  }
}

async function checkSessionIfNeeded(): Promise<boolean> {
  // Solo si hay cookie aparente / estamos en app (no en /login /offline).
  if (typeof window === "undefined") return true;
  const path = window.location.pathname;
  if (path.startsWith("/login") || path.startsWith("/offline")) return true;
  // Autoritativo: un único 401 no alcanza (ver session-authority.ts) — solo
  // "invalid" (confirmado dos veces) cuenta como sesión realmente vencida;
  // "unknown" (red/500) nunca se confunde con sesión inválida.
  const result = await resolveSessionAuthoritatively();
  return result.status !== "invalid";
}

async function tick() {
  if (hiddenPaused) {
    schedule();
    return;
  }
  if (status === "SIN_CONEXION" || status === "SERVIDOR_NO_DISPONIBLE") {
    emit("RECONNECTING");
  }
  const ping = await pingConnectivity();
  if (ping === "offline") {
    emit("SIN_CONEXION");
    backoffMs = Math.min(30_000, Math.max(4000, backoffMs * 1.5));
  } else if (ping === "server") {
    emit("SERVIDOR_NO_DISPONIBLE");
    backoffMs = Math.min(30_000, Math.max(4000, backoffMs * 1.5));
  } else {
    const sessionOk = await checkSessionIfNeeded();
    if (!sessionOk) {
      emit("SESION_VENCIDA");
    } else {
      emit("CONNECTED");
      backoffMs = 8000;
    }
  }
  schedule();
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void tick();
  }, backoffMs);
}

export function startConnectionMonitor(): () => void {
  if (typeof window === "undefined") return () => {};
  if (started) return () => {};
  started = true;

  const onOnline = () => {
    backoffMs = 2000;
    void tick();
  };
  const onOffline = () => emit("SIN_CONEXION");
  const onVisibility = () => {
    hiddenPaused = document.visibilityState === "hidden";
    if (!hiddenPaused) {
      backoffMs = 2000;
      void tick();
    }
  };

  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisibility);

  void tick();

  return () => {
    started = false;
    if (timer) clearTimeout(timer);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

export function reportRequestFailure(kind: "network" | "server" | "auth" = "network") {
  if (kind === "auth") emit("SESION_VENCIDA");
  else if (kind === "server") emit("SERVIDOR_NO_DISPONIBLE");
  else emit("SIN_CONEXION");
}

export function reportRequestSuccess() {
  if (status !== "SESION_VENCIDA") emit("CONNECTED");
}
