import {
  ACTOR_EMAIL_HEADER,
  ACTOR_SECTOR_HEADER,
} from "@/lib/auth/header-names";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
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

export async function fetchAsignacionLotesApi(
  session: OrdersClientSession,
  options: { includeArchived?: boolean } = {}
): Promise<{ items: AsignacionLote[]; schemaPending: boolean }> {
  const qs = new URLSearchParams();
  if (options.includeArchived) qs.set("includeArchived", "1");
  const res = await fetch(`/api/v1/asignacion-lotes?${qs}`, { credentials: "include", headers: headers(session) });
  const body = (await res.json()) as {
    items?: AsignacionLote[];
    error?: string;
    schemaPending?: boolean;
  };
  if (!res.ok) throw new Error(body.error ?? "No se pudieron cargar asignaciones de lotes");
  return {
    items: body.items ?? [],
    schemaPending: Boolean(body.schemaPending),
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
