"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CajasSummary } from "@/lib/cajas-genus/service";

export type { CajasSummary };
export const CAJAS_CHANGED_EVENT = "genus:cajas-changed";
export const notifyCajasChanged = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CAJAS_CHANGED_EVENT));
};

const API = "/api/v1/cajas-genus";

export async function cajasGet<T>(params: Record<string, string | undefined>): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v && v !== "TODOS") qs.set(k, v);
  const res = await fetch(`${API}?${qs.toString()}`, { cache: "no-store", credentials: "include" });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "No se pudo cargar.");
  return body;
}

export async function cajasPost<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(API, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "No se pudo guardar.");
  notifyCajasChanged();
  return body;
}

export const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/**
 * Stock y estado de la alerta calculados en el servidor. Se actualiza solo: al volver a la pestaña, cada `pollMs` y cuando otra parte de la pantalla
 * registra un movimiento (evento), sin recargar la aplicación.
 */
export function useCajasSummary(opts: { enabled?: boolean; pollMs?: number } = {}) {
  const { enabled = true, pollMs = 20_000 } = opts;
  const [summary, setSummary] = useState<CajasSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const load = useCallback(async () => {
    try {
      const r = await cajasGet<{ summary: CajasSummary | null }>({ view: "summary" });
      if (alive.current) {
        setSummary(r.summary);
        setError(null);
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "No se pudo cargar el stock.");
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    if (!enabled) return () => undefined;
    queueMicrotask(() => void load());
    const t = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void load();
    }, pollMs);
    const onChange = () => void load();
    const onVisible = () => document.visibilityState === "visible" && void load();
    window.addEventListener(CAJAS_CHANGED_EVENT, onChange);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive.current = false;
      clearInterval(t);
      window.removeEventListener(CAJAS_CHANGED_EVENT, onChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, pollMs, load]);
  return { summary, error, reload: load };
}
