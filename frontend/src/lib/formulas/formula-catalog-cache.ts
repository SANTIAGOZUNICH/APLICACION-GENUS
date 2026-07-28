import {
  fetchFormulaClientOptionsApi,
  fetchFormulaProductOptionsApi,
  type FormulaProductOption,
  type OrdersClientSession,
} from "@/lib/orders/orders-client";
import { recordFormulaSearchPerf } from "@/lib/formulas/formula-search-perf";

const TTL_MS = 10 * 60 * 1000;

type ClientRow = { client: string; source?: string };
type ClientsCacheEntry = { rows: ClientRow[]; fetchedAt: number; source: "DRIVE" | "CACHE_NEON" | null };
type ProductsCacheEntry = {
  products: FormulaProductOption[];
  fetchedAt: number;
  source: "DRIVE" | "CACHE_NEON" | null;
};

const clientsCache: { entry: ClientsCacheEntry | null } = { entry: null };
const productsByClient = new Map<string, ProductsCacheEntry>();
const clientsInFlight = new Map<string, Promise<ClientsCacheEntry>>();
const productsInFlight = new Map<string, Promise<ProductsCacheEntry>>();

function cacheKey(client: string): string {
  return client.trim().toLowerCase();
}

function isFresh(fetchedAt: number): boolean {
  return Date.now() - fetchedAt < TTL_MS;
}

export function getCachedClients(): ClientRow[] | null {
  const e = clientsCache.entry;
  if (!e || !isFresh(e.fetchedAt)) return null;
  return e.rows;
}

export function getCachedProducts(client: string): FormulaProductOption[] | null {
  const e = productsByClient.get(cacheKey(client));
  if (!e || !isFresh(e.fetchedAt)) return null;
  return e.products;
}

export function getCachedDataSource(): "DRIVE" | "CACHE_NEON" | null {
  return clientsCache.entry?.source ?? null;
}

export function invalidateFormulaCatalogCache(): void {
  clientsCache.entry = null;
  productsByClient.clear();
}

export async function loadClientsCatalog(
  session: OrdersClientSession,
  opts?: { force?: boolean; signal?: AbortSignal }
): Promise<ClientsCacheEntry> {
  if (!opts?.force) {
    const cached = clientsCache.entry;
    if (cached && isFresh(cached.fetchedAt)) return cached;
  }
  const inflightKey = "clients";
  const existing = clientsInFlight.get(inflightKey);
  if (existing && !opts?.force) return existing;

  const promise = (async (): Promise<ClientsCacheEntry> => {
    const t0 =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const res = await fetchFormulaClientOptionsApi(session, "", {
      signal: opts?.signal,
      limit: 500,
    });
    const t1 =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const src = (res.source === "CACHE_NEON" ? "CACHE_NEON" : "DRIVE") as
      | "DRIVE"
      | "CACHE_NEON";
    const entry: ClientsCacheEntry = {
      rows: res.clients.map((c) => ({
        client: c.client,
        source: c.source ?? src,
      })),
      fetchedAt: Date.now(),
      source: src,
    };
    recordFormulaSearchPerf({
      kind: "clients_fetch",
      queryLen: 0,
      resultCount: entry.rows.length,
      durationMs: Math.round((t1 - t0) * 1000) / 1000,
      cache: clientsCache.entry ? "hot" : "cold",
      indexedCount: entry.rows.length,
      source: src,
    });
    clientsCache.entry = entry;
    return entry;
  })();

  clientsInFlight.set(inflightKey, promise);
  try {
    return await promise;
  } finally {
    clientsInFlight.delete(inflightKey);
  }
}

export async function loadProductsCatalog(
  session: OrdersClientSession,
  client: string,
  opts?: { force?: boolean; signal?: AbortSignal }
): Promise<ProductsCacheEntry> {
  const key = cacheKey(client);
  if (!opts?.force) {
    const cached = productsByClient.get(key);
    if (cached && isFresh(cached.fetchedAt)) return cached;
  }
  const existing = productsInFlight.get(key);
  if (existing && !opts?.force) return existing;

  const promise = (async (): Promise<ProductsCacheEntry> => {
    const t0 =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const res = await fetchFormulaProductOptionsApi(session, client, "", {
      signal: opts?.signal,
      limit: 500,
    });
    const t1 =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const src = (res.source === "CACHE_NEON" ? "CACHE_NEON" : "DRIVE") as
      | "DRIVE"
      | "CACHE_NEON";
    const entry: ProductsCacheEntry = {
      products: res.products,
      fetchedAt: Date.now(),
      source: src,
    };
    recordFormulaSearchPerf({
      kind: "products_fetch",
      queryLen: 0,
      resultCount: entry.products.length,
      durationMs: Math.round((t1 - t0) * 1000) / 1000,
      cache: productsByClient.has(key) ? "hot" : "cold",
      indexedCount: entry.products.length,
      source: src,
    });
    productsByClient.set(key, entry);
    return entry;
  })();

  productsInFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    productsInFlight.delete(key);
  }
}
