import type { DeliveryHistoryEntry, ScheduledDelivery, WorkDivergence } from "./types";
import type { DeliveryInput } from "./rules";

/** Cliente HTTP de Entregas (navegador). Los errores del servidor ya vienen explicados en castellano. */
async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "include", cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  } catch {
    throw new Error("Sin conexión con el servidor: no se guardó nada. Revisá la conexión y volvé a intentar.");
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new EntregasApiError(body.error ?? `No se pudo completar la operación (${res.status}).`, res.status);
  return body;
}

export class EntregasApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "EntregasApiError";
  }
}

export interface DeliveryDetailResponse {
  delivery: ScheduledDelivery;
  divergences: Array<{ itemId: string; linkId: string; workItemId: string; divergences: WorkDivergence[] }>;
  history: DeliveryHistoryEntry[];
}

export const entregasApi = {
  list: (from: string, to: string) => call<{ deliveries: ScheduledDelivery[] }>(`/api/v1/entregas?from=${from}&to=${to}`).then((r) => r.deliveries),
  detail: (id: string) => call<DeliveryDetailResponse>(`/api/v1/entregas/${id}`),
  create: (input: DeliveryInput) => call<{ delivery: ScheduledDelivery }>("/api/v1/entregas", { method: "POST", body: JSON.stringify(input) }).then((r) => r.delivery),
  patch: <T = { delivery: ScheduledDelivery }>(id: string, body: Record<string, unknown>) => call<T>(`/api/v1/entregas/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
};
