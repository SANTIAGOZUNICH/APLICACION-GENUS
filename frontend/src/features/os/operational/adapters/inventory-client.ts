/** Cliente HTTP inventario ME/MP + estado de persistencia Neon. */
import { friendlyServerMessage } from "@/lib/ui/friendly-error";
import type { IngresoDiferenciasPayload } from "@/lib/inventory/me-diferencia";

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
        "No hay conexión con la base de datos: la planilla está vacía y no se puede guardar. Avisá a Sistemas.",
    };
  }
  if (!res.ok) {
    throw new InventoryClientError(friendlyServerMessage(res.status, json.error), res.status, json.code);
  }
  return { data: json.data ?? [], persistence: true };
}

export type BulkDeleteResult = { requested: number; deleted: string[]; skipped: string[]; failed: Array<{ id: string; message: string }> };

/** Eliminación múltiple en el servidor (ids explícitos o `all` = todos los registros activos, aunque no estén a la vista). */
export async function bulkDeleteInventory(resource: "me_ingresos" | "me_salidas" | "me_stock" | "me_inventario", target: { ids: string[] } | { all: true }): Promise<BulkDeleteResult> {
  const res = await mutateInventory<BulkDeleteResult>({
    action: "bulk_delete",
    resource,
    payload: "all" in target ? { scope: "all" } : { ids: target.ids },
  });
  return res.data;
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
        "No hay conexión con la base de datos: no se puede guardar. Avisá a Sistemas.",
      503,
      "DATABASE_REQUIRED"
    );
  }
  if (!res.ok) {
    throw new InventoryClientError(friendlyServerMessage(res.status, json.error), res.status, json.code);
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
  if (!json.results) return { ok: false, results: [], error: friendlyServerMessage(res.status, json.error) };
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
  if (!res.ok) throw new InventoryClientError(friendlyServerMessage(res.status, json.error), res.status, json.code);
  return json as MeAjusteResult;
}

export async function fetchMeMovimientos(materialId: string): Promise<{ codigo: string; stockActual: number; movimientos: import("@/lib/inventory/me-stock-calc").MeMovement[] }> {
  const res = await fetch(`/api/v1/inventory/me-movimientos?materialId=${encodeURIComponent(materialId)}`, { headers: actorHeaders(), cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new InventoryClientError(friendlyServerMessage(res.status, json.error), res.status);
  return json as never;
}

export async function fetchMeHistorial(id: string): Promise<import("@/lib/inventory/types").InventoryAudit[]> {
  const res = await fetch(`/api/v1/inventory/me-historial?id=${encodeURIComponent(id)}`, { headers: actorHeaders(), cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { entries?: import("@/lib/inventory/types").InventoryAudit[]; error?: string };
  if (!res.ok) throw new InventoryClientError(friendlyServerMessage(res.status, json.error), res.status);
  return json.entries ?? [];
}

// ─── Filas como en Excel: insertar en blanco y mover (orden manual persistente) ───────────────────────────────────
export type SheetRowResource = "mp_stock" | "mp_ingresos" | "me_ingresos" | "me_salidas" | "me_inventario";

/** Inserta una fila en blanco antes de `beforeId` (null = al final). */
export async function insertSheetRow(resource: SheetRowResource, beforeId: string | null): Promise<{ id: string; position: number }> {
  const res = await fetch("/api/v1/inventory/rows", { method: "POST", headers: actorHeaders(), body: JSON.stringify({ action: "insert", resource, beforeId }) });
  const json = (await res.json().catch(() => ({}))) as { id?: string; position?: number; error?: string; code?: string };
  if (!res.ok || !json.id) throw new InventoryClientError(friendlyServerMessage(res.status, json.error), res.status, json.code);
  return { id: json.id, position: json.position ?? 0 };
}

/** Mueve la fila `id` para que quede antes de `beforeId` (null = al final). */
export async function moveSheetRowApi(resource: SheetRowResource, id: string, beforeId: string | null): Promise<{ position: number }> {
  const res = await fetch("/api/v1/inventory/rows", { method: "POST", headers: actorHeaders(), body: JSON.stringify({ action: "move", resource, id, beforeId }) });
  const json = (await res.json().catch(() => ({}))) as { position?: number; error?: string; code?: string };
  if (!res.ok) throw new InventoryClientError(friendlyServerMessage(res.status, json.error), res.status, json.code);
  return { position: json.position ?? 0 };
}

/** DIFERENCIA de Ingresos ME (control de recepción contra el pedido). Solo lectura de stock; el vínculo no mueve inventario. */
export async function fetchIngresoDiferencias(): Promise<IngresoDiferenciasPayload> {
  const res = await fetch("/api/v1/inventory/me-diferencia", { headers: actorHeaders(), cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { data?: IngresoDiferenciasPayload; error?: string; code?: string };
  if (!res.ok) throw new InventoryClientError(friendlyServerMessage(res.status, json.error), res.status, json.code);
  return json.data ?? { ingresos: {} };
}

export type IngresoPedidoCandidato = { pedidoId: string; cliente: string; producto: string; unidades: number | null; estado: string };

export async function fetchIngresoPedidoCandidatos(ingresoId: string): Promise<IngresoPedidoCandidato[]> {
  const res = await fetch(`/api/v1/inventory/me-diferencia?candidatos=${encodeURIComponent(ingresoId)}`, { headers: actorHeaders(), cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { data?: IngresoPedidoCandidato[]; error?: string; code?: string };
  if (!res.ok) throw new InventoryClientError(friendlyServerMessage(res.status, json.error), res.status, json.code);
  return json.data ?? [];
}

export async function postIngresoPedidoLink(body: { action: "link" | "unlink"; ingresoId: string; pedidoId?: string; unidadesPorProducto?: number | null }): Promise<void> {
  const res = await fetch("/api/v1/inventory/me-diferencia", { method: "POST", headers: actorHeaders(), body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new InventoryClientError(friendlyServerMessage(res.status, json.error), res.status, json.code);
}

export type MeDeletionHistoryEntry = { id: string; module: string; entityId: string; action: string; actor: string; createdAt: string; before: Record<string, unknown> | null };

/** Historial interno de eliminaciones (auditoría) de una tabla de Depósito ME. */
export async function fetchMeDeletions(resource: "me_ingresos" | "me_salidas" | "me_stock"): Promise<MeDeletionHistoryEntry[]> {
  const res = await fetch(`/api/v1/inventory/eliminaciones?resource=${resource}`, { headers: actorHeaders(), cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { entries?: MeDeletionHistoryEntry[]; error?: string };
  if (!res.ok || !json.entries) throw new InventoryClientError(friendlyServerMessage(res.status, json.error), res.status);
  return json.entries;
}
