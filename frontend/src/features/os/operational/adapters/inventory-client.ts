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
