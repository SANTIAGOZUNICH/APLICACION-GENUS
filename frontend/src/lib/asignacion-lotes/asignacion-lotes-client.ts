import {
  ACTOR_EMAIL_HEADER,
  ACTOR_SECTOR_HEADER,
} from "@/lib/auth/header-names";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import type {
  AsignacionCellChange,
  AsignacionCellFailure,
} from "@/lib/asignacion-lotes/cell-edit";
import type {
  AsignacionLote,
  AsignacionLoteImportResult,
  AsignacionLoteUpsertInput,
} from "@/lib/asignacion-lotes/types";

function headers(session: OrdersClientSession): HeadersInit {
  return {
    "Content-Type": "application/json",
    [ACTOR_EMAIL_HEADER]: session.email,
    [ACTOR_SECTOR_HEADER]: session.sector,
  };
}

/** Error al LISTAR: conserva el código del servidor (p. ej. esquema pendiente) para explicarlo en pantalla. */
export class AsignacionLotesLoadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null
  ) {
    super(message);
    this.name = "AsignacionLotesLoadError";
  }
  /** La base no tiene la migración que necesita esta versión (0043): no es un problema de conexión. */
  get schemaPending(): boolean {
    return this.code === "ASIGNACION_LOTES_SCHEMA_PENDING" || this.code === "SCHEMA_PENDING";
  }
}

export async function fetchAsignacionLotesApi(
  session: OrdersClientSession,
  options: { includeArchived?: boolean } = {}
): Promise<{
  items: AsignacionLote[];
  schemaPending: boolean;
  writableSourceIds: string[];
  /** Commit desplegado en el servidor ("" fuera de Vercel). */
  build: string;
  /** La base tiene la capa de ediciones de GENUS (0043). */
  localEditsReady: boolean;
}> {
  const qs = new URLSearchParams();
  if (options.includeArchived) qs.set("includeArchived", "1");
  let res: Response;
  try {
    res = await fetch(`/api/v1/asignacion-lotes?${qs}`, { credentials: "include", headers: headers(session) });
  } catch {
    throw new AsignacionLotesLoadError("Sin conexión con el servidor.", 0, "OFFLINE");
  }
  const body = (await res.json().catch(() => ({}))) as {
    items?: AsignacionLote[];
    error?: string;
    code?: string;
    schemaPending?: boolean;
    writableSourceIds?: string[];
    build?: string;
    localEditsReady?: boolean;
  };
  if (!res.ok) {
    throw new AsignacionLotesLoadError(body.error ?? "No se pudieron cargar asignaciones de lotes", res.status, body.code ?? null);
  }
  return {
    items: body.items ?? [],
    schemaPending: Boolean(body.schemaPending),
    writableSourceIds: body.writableSourceIds ?? [],
    build: body.build ?? "",
    localEditsReady: body.localEditsReady ?? false,
  };
}

export async function upsertAsignacionLoteApi(
  session: OrdersClientSession,
  record: AsignacionLoteUpsertInput
): Promise<AsignacionLote> {
  const res = await fetch("/api/v1/asignacion-lotes", {
    method: "POST",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify({
      action: "upsert",
      actorSectorId: session.sector,
      record,
    }),
  });
  const body = (await res.json()) as { item?: AsignacionLote; error?: string };
  if (!res.ok) throw new Error(body.error ?? "No se pudo guardar la asignación");
  return body.item!;
}

export async function importAsignacionLotesApi(
  session: OrdersClientSession,
  rows: AsignacionLoteUpsertInput[]
): Promise<AsignacionLoteImportResult> {
  const res = await fetch("/api/v1/asignacion-lotes", {
    method: "POST",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify({
      action: "import",
      actorSectorId: session.sector,
      rows,
    }),
  });
  const body = (await res.json()) as { result?: AsignacionLoteImportResult; error?: string };
  if (!res.ok) throw new Error(body.error ?? "No se pudo importar");
  return body.result!;
}

export async function patchAsignacionLoteApi(
  session: OrdersClientSession,
  id: string,
  lifecycleAction: "restore"
): Promise<AsignacionLote> {
  const res = await fetch(`/api/v1/asignacion-lotes/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify({
      lifecycleAction,
      actorSectorId: session.sector,
    }),
  });
  const body = (await res.json()) as { item?: AsignacionLote; error?: string };
  if (!res.ok) throw new Error(body.error ?? "No se pudo actualizar la asignación");
  return body.item!;
}

export async function deleteAsignacionLoteApi(
  session: OrdersClientSession,
  id: string,
  reason?: string
): Promise<void> {
  const res = await fetch(`/api/v1/asignacion-lotes/${id}`, {
    method: "DELETE",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify({ actorSectorId: session.sector, reason }),
  });
  const body = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? "No se pudo eliminar la asignación");
}

export class AsignacionCellsApiError extends Error {
  constructor(
    message: string,
    readonly failures: AsignacionCellFailure[],
    readonly status: number,
    /** Registros que SÍ quedaron consistentes pese al fallo parcial (para refrescar la UI). */
    readonly items: AsignacionLote[] = []
  ) {
    super(message);
    this.name = "AsignacionCellsApiError";
  }
}

/**
 * PATCH parcial por celda (atómico). Envía SOLO {id, campo, valor, versión}
 * por celda — nunca la fila completa. Resuelve únicamente si el servidor
 * confirmó la persistencia; ante rechazo lanza AsignacionCellsApiError con
 * el detalle por celda.
 */
export async function patchAsignacionLoteCellsApi(
  session: OrdersClientSession,
  changes: AsignacionCellChange[]
): Promise<{ items: AsignacionLote[]; changedCells: number; unchangedCells: number }> {
  let res: Response;
  try {
    res = await fetch("/api/v1/asignacion-lotes/cells", {
      method: "PATCH",
      credentials: "include",
      headers: headers(session),
      body: JSON.stringify({ actorSectorId: session.sector, changes }),
    });
  } catch {
    throw new AsignacionCellsApiError("Sin conexión con el servidor. Reintentá.", [], 0);
  }
  const body = (await res.json().catch(() => ({}))) as {
    items?: AsignacionLote[];
    changedCells?: number;
    unchangedCells?: number;
    error?: string;
    failures?: AsignacionCellFailure[];
  };
  if (!res.ok) {
    throw new AsignacionCellsApiError(
      body.failures?.[0]?.message ?? body.error ?? "No se pudo guardar el cambio.",
      body.failures ?? [],
      res.status,
      body.items ?? []
    );
  }
  return {
    items: body.items ?? [],
    changedCells: body.changedCells ?? 0,
    unchangedCells: body.unchangedCells ?? 0,
  };
}

export type AsignacionLoteHistoryEntryDto =
  | { kind: "CHANGE"; at: string; actor: string; actorSector: string; field: string; oldValue: string | null; newValue: string | null; batchId: string; origin: "FORM" | "CELL" }
  | { kind: "CREATED"; at: string; actor: string; origin: "SYNC" | "MANUAL" }
  | { kind: "ARCHIVED"; at: string; actor: string; reason: string | null };

/** Historial de cambios de un lote (solo lectura). */
export async function fetchAsignacionLoteHistoryApi(session: OrdersClientSession, id: string): Promise<AsignacionLoteHistoryEntryDto[]> {
  const res = await fetch(`/api/v1/asignacion-lotes/${encodeURIComponent(id)}/history`, { credentials: "include", headers: headers(session) });
  const body = (await res.json().catch(() => ({}))) as { entries?: AsignacionLoteHistoryEntryDto[]; error?: string };
  if (!res.ok) throw new Error(body.error ?? `No se pudo leer el historial (${res.status}).`);
  return body.entries ?? [];
}

/** 0043 — Decide sobre una edición de GENUS en un lote sincronizado. Lanza con el motivo real si no se guardó. */
export async function resolveAsignacionLocalEditApi(
  session: OrdersClientSession,
  body: { editId: string; action: "KEEP_GENUS" | "USE_SHEET" | "REVERT_TO_SHEET" | "ARCHIVE"; expectedVersion: string; reason?: string }
): Promise<AsignacionLote> {
  const res = await fetch("/api/v1/asignacion-lotes/local-edits", {
    method: "POST",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify({ actorSectorId: session.sector, ...body }),
  });
  const json = (await res.json().catch(() => ({}))) as { item?: AsignacionLote; error?: string };
  if (!res.ok || !json.item) throw new Error(json.error ?? `No se pudo guardar la decisión (${res.status}).`);
  return json.item;
}
