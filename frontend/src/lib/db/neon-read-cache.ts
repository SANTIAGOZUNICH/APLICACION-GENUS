/**
 * Caché de lectura en proceso (warm lambda) para reducir re-SELECT a Neon.
 * No sustituye Redis; sí evita refetch dentro del TTL en la misma instancia.
 */

export type NeonReadCacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const store = new Map<string, NeonReadCacheEntry<unknown>>();

export function getNeonReadCache<T>(key: string): T | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    store.delete(key);
    return null;
  }
  return hit.value as T;
}

export function setNeonReadCache<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + Math.max(0, ttlMs) });
}

export function invalidateNeonReadCache(prefixOrKey?: string): void {
  if (!prefixOrKey) {
    store.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key === prefixOrKey || key.startsWith(prefixOrKey)) {
      store.delete(key);
    }
  }
}

/** Ejecuta `loader` solo si el caché expiró. */
export async function withNeonReadCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const cached = getNeonReadCache<T>(key);
  if (cached !== null) return cached;
  const value = await loader();
  setNeonReadCache(key, value, ttlMs);
  return value;
}
