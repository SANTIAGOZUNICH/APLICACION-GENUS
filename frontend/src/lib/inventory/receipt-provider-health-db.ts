/** Circuit breaker de proveedores de lectura compartido entre instancias (tabla `ai_provider_health`, 0086). Mejor esfuerzo: si la base falla, no frena la lectura. */
import "server-only";

import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { aiProviderHealth } from "@/lib/db/schema";
import { AVAILABILITY_KINDS, emptyState, openDurationMs, type FailureSignal, type ProviderHealthStore, type ProviderId, type ProviderState } from "./receipt-provider-health";

const CACHE_MS = 4_000;
const cache = new Map<ProviderId, { at: number; state: ProviderState }>();

export function createDbHealthStore(): ProviderHealthStore {
  return {
    async state(p) {
      const hit = cache.get(p);
      if (hit && Date.now() - hit.at < CACHE_MS) return hit.state;
      try {
        const [row] = await getDb().select().from(aiProviderHealth).where(eq(aiProviderHealth.provider, p)).limit(1);
        const state: ProviderState = row
          ? { consecutiveFailures: row.consecutiveFailures, openUntil: row.openUntil?.getTime() ?? 0, lastKind: row.lastKind, lastHttp: row.lastHttp, lastFailureAt: row.lastFailureAt?.getTime() ?? null, lastSuccessAt: row.lastSuccessAt?.getTime() ?? null }
          : emptyState();
        cache.set(p, { at: Date.now(), state });
        return state;
      } catch {
        return emptyState(); // sin base no hay breaker compartido: se lee igual
      }
    },
    async recordSuccess(p, now = Date.now()) {
      cache.delete(p);
      try {
        await getDb()
          .insert(aiProviderHealth)
          .values({ provider: p, consecutiveFailures: 0, openUntil: null, lastSuccessAt: new Date(now), totalSuccess: 1 })
          .onConflictDoUpdate({ target: aiProviderHealth.provider, set: { consecutiveFailures: 0, openUntil: null, lastSuccessAt: new Date(now), totalSuccess: sql`${aiProviderHealth.totalSuccess} + 1`, updatedAt: new Date(now) } });
      } catch { /* informativo */ }
    },
    async recordFailure(p: ProviderId, f: FailureSignal, now = Date.now()) {
      if (!AVAILABILITY_KINDS.has(f.kind)) return;
      cache.delete(p);
      try {
        const [row] = await getDb().select().from(aiProviderHealth).where(eq(aiProviderHealth.provider, p)).limit(1);
        const consecutive = (row?.consecutiveFailures ?? 0) + 1;
        const dur = openDurationMs(f, consecutive);
        const openUntil = dur > 0 ? new Date(now + dur) : (row?.openUntil ?? null);
        await getDb()
          .insert(aiProviderHealth)
          .values({ provider: p, consecutiveFailures: consecutive, openUntil, lastKind: f.kind, lastHttp: f.http ?? null, lastFailureAt: new Date(now), totalFailure: 1 })
          .onConflictDoUpdate({ target: aiProviderHealth.provider, set: { consecutiveFailures: consecutive, openUntil, lastKind: f.kind, lastHttp: f.http ?? null, lastFailureAt: new Date(now), totalFailure: sql`${aiProviderHealth.totalFailure} + 1`, updatedAt: new Date(now) } });
      } catch { /* informativo */ }
    },
  };
}
