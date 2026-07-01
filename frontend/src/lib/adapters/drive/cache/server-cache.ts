import "server-only";

import { getServerDataMode } from "@/lib/config/data-mode";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

function getDefaultTtlMs(): number {
  const seconds = Number(process.env.GENUS_DRIVE_CACHE_TTL_SECONDS ?? "600");
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }
  return 600_000;
}

/** In-memory TTL cache — server-side only. */
export class ServerCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs = getDefaultTtlMs()): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  deleteByPrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }

  stats() {
    return {
      entries: this.store.size,
      ttlSeconds: getDefaultTtlMs() / 1000,
    };
  }
}

export const serverCache = new ServerCache();

export function isRealDataMode(): boolean {
  return getServerDataMode() === "real";
}
