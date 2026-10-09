/** Cliente HTTP inventario ME/MP + estado de persistencia Neon. */

import { getCurrentAuthSession } from "@/features/os/auth/lib/auth-session-helpers";

export type InventoryResource =
  | "me_ingresos"
  | "me_salidas"
  | "me_stock"
  | "me_inventario"
  | "me_avisos"
  | "mp_stock"
  | "mp_ingresos"
  | "mp_control"
  | "mp_compras";

function actorHeaders(): HeadersInit {
  const session = getCurrentAuthSession();
  return {
    "Content-Type": "application/json",
    "x-genus-actor-email": session?.user.email ?? "",
    "x-genus-actor-sector": session?.sector.id ?? "",
  };
}

export class InventoryClientError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code = "ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function fetchInventory<T>(resource: InventoryResource): Promise<{
  data: T[];
  persistence: boolean;
  message?: string;
}> {
  const res = await fetch(`/api/v1/inventory?resource=${resource}`, {
    headers: actorHeaders(),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: T[];
    error?: string;
    code?: string;
    persistence?: boolean;
  };
  if (res.status === 503) {
    return {
      data: [],
      persistence: false,
      message:
        json.error ??
        "Sin DATABASE_URL (Neon): vista demostrativa vacía. No se puede guardar.",
    };
  }
  if (!res.ok) {
    throw new InventoryClientError(json.error ?? "Error al cargar inventario", res.status, json.code);
  }
  return { data: json.data ?? [], persistence: true };
}

export async function mutateInventory<T>(body: {
  action: string;
  resource: InventoryResource | "semanas";
  payload?: Record<string, unknown>;
  id?: string;
  reason?: string;
}): Promise<{ data: T; persistence: boolean }> {
  const res = await fetch("/api/v1/inventory", {
    method: "POST",
    headers: actorHeaders(),
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: T;
    error?: string;
    code?: string;
    persistence?: boolean;
  };
  if (res.status === 503) {
    throw new InventoryClientError(
      json.error ??
        "Sin DATABASE_URL (Neon): no se puede guardar. Vista demostrativa vacía.",
      503,
      "DATABASE_REQUIRED"
    );
  }
  if (!res.ok) {
    throw new InventoryClientError(json.error ?? "Operación rechazada", res.status, json.code);
  }
  return { data: json.data as T, persistence: true };
}

export interface InventoryCellApiResult {
  ok: boolean;
  results: Array<{ ok: boolean; message?: string; code?: string }>;
  error?: string;
}

/** PATCH parcial por celda (Inventario ME / Stock MP). No lanza por rechazos de negocio: devuelve cada resultado. */
export async function patchInventoryCells(
  resource: "me_inventario" | "mp_stock" | "me_ingresos" | "me_salidas" | "mp_ingresos" | "mp_compras",
  changes: import("@/lib/inventory/cell-edit").InventoryCellChange[]
): Promise<InventoryCellApiResult> {
  const res = await fetch("/api/v1/inventory/cells", {
    method: "PATCH",
    headers: actorHeaders(),
    body: JSON.stringify({ resource, changes }),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<InventoryCellApiResult>;
  if (!json.results) return { ok: false, results: [], error: json.error ?? `Error ${res.status} al guardar.` };
  return { ok: Boolean(json.ok), results: json.results, error: json.error };
}

// ─── Etapa 2: Depósito ME (ajustes, movimientos, historial) ───────────────────

export interface MeAjusteResult {
  stockAnterior: number;
  stockActual: number;
}
/** Ajuste de inventario ME. Lanza InventoryClientError con el motivo real (409 si el stock cambió mientras tanto). */
export async function postMeAjuste(body: { materialId: string; expectedStock: number; newStock: number; motivo: string; tipo: string }): Promise<MeAjusteResult> {
  const res = await fetch("/api/v1/inventory/me-ajustes", { method: "POST", headers: actorHeaders(), body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as Partial<MeAjusteResult> & { error?: string; code?: string };
  if (!res.ok) throw new InventoryClientError(json.error ?? `Error ${res.status} al ajustar.`, res.status, json.code);
  return json as MeAjusteResult;
}

export async function fetchMeMovimientos(materialId: string): Promise<{ codigo: string; stockActual: number; movimientos: import("@/lib/inventory/me-stock-calc").MeMovement[] }> {
  const res = await fetch(`/api/v1/inventory/me-movimientos?materialId=${encodeURIComponent(materialId)}`, { headers: actorHeaders(), cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new InventoryClientError(json.error ?? `Error ${res.status}`, res.status);
  return json as never;
}

export async function fetchMeHistorial(id: string): Promise<import("@/lib/inventory/types").InventoryAudit[]> {
  const res = await fetch(`/api/v1/inventory/me-historial?id=${encodeURIComponent(id)}`, { headers: actorHeaders(), cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { entries?: import("@/lib/inventory/types").InventoryAudit[]; error?: string };
  if (!res.ok) throw new InventoryClientError(json.error ?? `Error ${res.status}`, res.status);
  return json.entries ?? [];
}
