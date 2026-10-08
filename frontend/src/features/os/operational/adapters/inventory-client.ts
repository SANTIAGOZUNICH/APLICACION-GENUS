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
  resource: "me_inventario" | "mp_stock",
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
