/** Cliente de navegador — módulo INSUMOS. La identidad la resuelve el servidor por la cookie de sesión (los headers son solo para modo test). */
import { getCurrentAuthSession } from "@/features/os/auth/lib/auth-session-helpers";
import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import type { CatalogResponse, CreateRetiroInput, CreateRetiroResult, InsumoFilters, InsumoItem, InsumoResponsable, Retiro, RetiroEvent } from "./types";

const BASE = "/api/v1/insumos";

export class InsumosApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
  }
}

function headers(): Record<string, string> {
  const s = getCurrentAuthSession();
  return { "Content-Type": "application/json", [ACTOR_EMAIL_HEADER]: s?.user.email ?? "", [ACTOR_SECTOR_HEADER]: s?.sector.id ?? "" };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, credentials: "include", cache: "no-store", headers: { ...headers(), ...(init?.headers ?? {}) } });
  } catch {
    throw new InsumosApiError("No hay conexión con el servidor. Revisá tu internet y volvé a intentar.", 0, "NETWORK");
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new InsumosApiError(String(body.error ?? "No se pudo completar la operación."), res.status, String(body.code ?? "ERROR"));
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const fetchCatalog = (all = false) => call<CatalogResponse>(`/catalog${all ? "?all=1" : ""}`);
export const createRetiroApi = (input: CreateRetiroInput) => call<CreateRetiroResult>("/retiros", json("POST", input));

export function fetchRetiros(f: InsumoFilters): Promise<{ retiros: Retiro[]; truncated: boolean }> {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  return call(`/retiros${p.size ? `?${p}` : ""}`);
}
export const fetchRetiroEvents = (id: string) => call<{ events: RetiroEvent[] }>(`/retiros/${id}`).then((r) => r.events);
export const anularRetiroApi = (id: string, motivo: string) => call<{ retiro: Retiro }>(`/retiros/${id}`, json("PATCH", { action: "anular", motivo })).then((r) => r.retiro);
export const corregirRetiroApi = (id: string, body: { motivo: string; responsableId?: string; lines?: Array<{ insumoId: string; cantidad: number }> }) =>
  call<{ retiro: Retiro }>(`/retiros/${id}`, json("PATCH", { action: "corregir", ...body })).then((r) => r.retiro);

export const createItemApi = (name: string) => call<{ item: InsumoItem }>("/items", json("POST", { name })).then((r) => r.item);
export const updateItemApi = (id: string, patch: { name?: string; active?: boolean }) => call<{ item: InsumoItem }>(`/items/${id}`, json("PATCH", patch)).then((r) => r.item);
export const reorderItemsApi = (orderedIds: string[]) => call<{ items: InsumoItem[] }>("/items", json("PUT", { orderedIds }));
export const createResponsableApi = (sector: string, name: string) => call<{ responsable: InsumoResponsable }>("/responsables", json("POST", { sector, name })).then((r) => r.responsable);
export const updateResponsableApi = (id: string, patch: { name?: string; active?: boolean }) => call<{ responsable: InsumoResponsable }>(`/responsables/${id}`, json("PATCH", patch)).then((r) => r.responsable);
export const reorderResponsablesApi = (sector: string, orderedIds: string[]) => call<{ responsables: InsumoResponsable[] }>("/responsables", json("PUT", { sector, orderedIds }));
