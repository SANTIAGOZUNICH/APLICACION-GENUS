/**
 * Circuit breaker de los proveedores de lectura de remitos (Gemini / OpenAI).
 *
 * Problema real (logs de Vercel, 24/11/2026): con Gemini saturado cada remito consumía ~39 s reintentando el MISMO proveedor y terminaba en
 * timeout sin haber probado nada más. Ahora, si un proveedor falla de forma consecutiva (o dice «cuota»), se lo SALTEA un rato y la lectura
 * pasa directo al siguiente, así un remito nuevo no vuelve a esperar a un proveedor caído. Pasado el tiempo se hace UNA prueba (half-open).
 *
 * Este módulo es puro (memoria). La versión compartida entre instancias de Vercel está en `receipt-provider-health-db.ts` (misma interfaz).
 */
export type ProviderId = "gemini" | "openai";

export type FailureSignal = { kind: string; http?: number | null; retryAfterMs?: number | null };
export type ProviderState = {
  consecutiveFailures: number;
  openUntil: number; // epoch ms (0 = cerrado)
  lastKind: string | null;
  lastHttp: number | null;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
};
export const emptyState = (): ProviderState => ({ consecutiveFailures: 0, openUntil: 0, lastKind: null, lastHttp: null, lastFailureAt: null, lastSuccessAt: null });

export interface ProviderHealthStore {
  state(p: ProviderId): Promise<ProviderState>;
  recordSuccess(p: ProviderId, now?: number): Promise<void>;
  recordFailure(p: ProviderId, f: FailureSignal, now?: number): Promise<void>;
}

const MIN = 60_000;
/** Tipos de falla que significan «este proveedor no sirve ahora»; el resto (p. ej. imagen ilegible) no cuenta contra el proveedor. */
export const AVAILABILITY_KINDS = new Set(["overloaded", "unavailable", "timeout", "limit", "quota", "key", "permission", "region", "model"]);

/** Cuánto se saltea el proveedor tras esta falla (0 = todavía no abre el circuito). Función pura, probada. */
export function openDurationMs(f: FailureSignal, consecutiveAfter: number): number {
  const ra = Math.max(0, Number(f.retryAfterMs ?? 0) || 0);
  switch (f.kind) {
    case "quota": return Math.min(15 * MIN, Math.max(5 * MIN, ra));
    case "limit": return Math.min(5 * MIN, Math.max(MIN, ra)); // 429 por minuto: sin cupo ahora; abre con UNA sola ocurrencia
    case "key":
    case "permission":
    case "region": return 10 * MIN; // configuración: reintentar no sirve
    case "model": return consecutiveAfter >= 2 ? 10 * MIN : 0;
    case "overloaded":
    case "unavailable":
    case "timeout": return consecutiveAfter >= 2 ? Math.min(5 * MIN, 90_000 * 2 ** Math.min(consecutiveAfter - 2, 2)) : 0;
    default: return 0;
  }
}

export function createMemoryHealthStore(): ProviderHealthStore & { reset(): void } {
  const m = new Map<ProviderId, ProviderState>();
  const get = (p: ProviderId) => m.get(p) ?? emptyState();
  return {
    async state(p) { return get(p); },
    async recordSuccess(p, now = Date.now()) { m.set(p, { ...emptyState(), lastSuccessAt: now }); },
    async recordFailure(p, f, now = Date.now()) {
      if (!AVAILABILITY_KINDS.has(f.kind)) return;
      const cur = get(p);
      const consecutive = cur.consecutiveFailures + 1;
      const dur = openDurationMs(f, consecutive);
      m.set(p, { ...cur, consecutiveFailures: consecutive, openUntil: dur > 0 ? now + dur : cur.openUntil, lastKind: f.kind, lastHttp: f.http ?? null, lastFailureAt: now });
    },
    reset() { m.clear(); },
  };
}

/** Store por defecto (por instancia). El servicio lo reemplaza por el compartido en la base. */
export const memoryHealth = createMemoryHealthStore();

export async function isProviderOpen(store: ProviderHealthStore, p: ProviderId, now = Date.now()): Promise<{ open: boolean; until: number; state: ProviderState }> {
  const state = await store.state(p);
  return { open: state.openUntil > now, until: state.openUntil, state };
}
