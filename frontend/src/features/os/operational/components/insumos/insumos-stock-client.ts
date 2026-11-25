"use client";

/** Cliente de navegador — stock de INSUMOS (solo lectura de datos por API; nada de colas ni almacenamiento local). */
import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentAuthSession } from "@/features/os/auth/lib/auth-session-helpers";
import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import type { MovementView, StockAuditView, StockRowView, StockSummaryView } from "@/lib/insumos/stock-service";

export type { MovementView, StockAuditView, StockRowView, StockSummaryView };
export const INSUMOS_CHANGED_EVENT = "genus:insumos-changed";
export const notifyInsumosChanged = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(INSUMOS_CHANGED_EVENT));
};

const API = "/api/v1/insumos/stock";
const headers = (): Record<string, string> => {
  const s = getCurrentAuthSession();
  return { "Content-Type": "application/json", [ACTOR_EMAIL_HEADER]: s?.user.email ?? "", [ACTOR_SECTOR_HEADER]: s?.sector.id ?? "" };
};

export async function stockGet<T>(params: Record<string, string | undefined>): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const res = await fetch(`${API}?${qs}`, { cache: "no-store", credentials: "include", headers: headers() });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "No se pudo cargar el stock.");
  return body;
}

export async function stockPost<T = { row: StockRowView }>(action: string, payload: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API, { method: "POST", credentials: "include", headers: headers(), body: JSON.stringify({ action, ...payload }) });
  } catch {
    throw new Error("No hay conexión con el servidor. Revisá tu internet y volvé a intentar: no se registra dos veces.");
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "No se pudo guardar.");
  notifyInsumosChanged();
  return body;
}

export const newStockKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/**
 * Stock y cantidad de insumos que requieren reposición, calculados en el servidor. Se actualiza solo: al volver a la pestaña, cada `pollMs`
 * y cuando otra parte de la pantalla registra un cambio (evento), sin recargar la aplicación.
 */
export function useInsumosStock(opts: { enabled?: boolean; pollMs?: number } = {}) {
  const { enabled = true, pollMs = 20_000 } = opts;
  const [summary, setSummary] = useState<StockSummaryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const load = useCallback(async () => {
    try {
      const r = await stockGet<{ summary: StockSummaryView }>({ view: "summary" });
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
    window.addEventListener(INSUMOS_CHANGED_EVENT, onChange);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive.current = false;
      clearInterval(t);
      window.removeEventListener(INSUMOS_CHANGED_EVENT, onChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, pollMs, load]);
  return { summary, error, reload: load };
}
