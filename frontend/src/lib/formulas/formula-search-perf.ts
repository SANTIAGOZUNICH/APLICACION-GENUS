/**
 * Instrumentación de búsqueda Cliente/Producto (sin exponer fórmulas).
 * Usar en tests y en consola de desarrollo; no muestra ingredientes/%.
 */

export type FormulaSearchPerfEvent = {
  kind: "clients_filter" | "products_filter" | "clients_fetch" | "products_fetch";
  queryLen: number;
  resultCount: number;
  durationMs: number;
  cache: "hot" | "cold" | "n/a";
  indexedCount?: number;
  source?: "DRIVE" | "CACHE_NEON" | "MEMORY" | null;
};

type Counters = {
  remoteFetches: number;
  localFilters: number;
  lastEvents: FormulaSearchPerfEvent[];
};

const MAX_EVENTS = 40;
const counters: Counters = {
  remoteFetches: 0,
  localFilters: 0,
  lastEvents: [],
};

export function resetFormulaSearchPerf(): void {
  counters.remoteFetches = 0;
  counters.localFilters = 0;
  counters.lastEvents = [];
}

export function recordFormulaSearchPerf(event: FormulaSearchPerfEvent): void {
  if (event.kind === "clients_fetch" || event.kind === "products_fetch") {
    counters.remoteFetches += 1;
  } else {
    counters.localFilters += 1;
  }
  counters.lastEvents.push(event);
  if (counters.lastEvents.length > MAX_EVENTS) {
    counters.lastEvents.shift();
  }
  if (typeof process !== "undefined" && process.env.NODE_ENV === "development") {
    // eslint-disable-next-line no-console
    console.debug("[formula-search-perf]", event);
  }
}

export function getFormulaSearchPerfSnapshot(): {
  remoteFetches: number;
  localFilters: number;
  lastEvents: FormulaSearchPerfEvent[];
} {
  return {
    remoteFetches: counters.remoteFetches,
    localFilters: counters.localFilters,
    lastEvents: [...counters.lastEvents],
  };
}

/** Mide filtro en memoria; no bloquea UI. */
export function timeLocalFilter<T>(
  kind: "clients_filter" | "products_filter",
  query: string,
  indexedCount: number,
  cache: "hot" | "cold",
  run: () => T
): T {
  const t0 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const result = run();
  const t1 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const resultCount = Array.isArray(result) ? result.length : 0;
  recordFormulaSearchPerf({
    kind,
    queryLen: query.trim().length,
    resultCount,
    durationMs: Math.round((t1 - t0) * 1000) / 1000,
    cache,
    indexedCount,
    source: "MEMORY",
  });
  return result;
}
