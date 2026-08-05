/** Cliente de navegador — Depósito Graneles (API Neon, migración 0014). */
import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import type {
  CreateManualGranelInput,
  GranelRemainderRecord,
  GranelStatus,
  UpdateGranelPatch,
  UpsertGranelFromEnvasadoInput,
} from "@/lib/graneles/types";

function headers(session: OrdersClientSession): HeadersInit {
  return {
    "Content-Type": "application/json",
    [ACTOR_EMAIL_HEADER]: session.email,
    [ACTOR_SECTOR_HEADER]: session.sector,
  };
}

export async function fetchGranelesApi(
  session: OrdersClientSession,
  options: { includeAnnulled?: boolean; status?: GranelStatus } = {}
): Promise<{ items: GranelRemainderRecord[]; schemaPending: boolean }> {
  const qs = new URLSearchParams();
  if (options.includeAnnulled) qs.set("includeAnnulled", "1");
  if (options.status) qs.set("status", options.status);
  const res = await fetch(`/api/v1/deposito-graneles?${qs}`, {
    credentials: "include",
    headers: headers(session),
  });
  const body = (await res.json()) as {
    items?: GranelRemainderRecord[];
    error?: string;
    schemaPending?: boolean;
  };
  if (!res.ok) throw new Error(body.error ?? "No se pudieron cargar los sobrantes de granel.");
  return { items: body.items ?? [], schemaPending: Boolean(body.schemaPending) };
}

export async function createManualGranelApi(
  session: OrdersClientSession,
  record: CreateManualGranelInput
): Promise<GranelRemainderRecord> {
  const res = await fetch("/api/v1/deposito-graneles", {
    method: "POST",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify({ action: "createManual", actorSectorId: session.sector, record }),
  });
  const body = (await res.json()) as { record?: GranelRemainderRecord; error?: string };
  if (!res.ok) throw new Error(body.error ?? "No se pudo registrar el sobrante.");
  return body.record!;
}

export async function upsertGranelFromEnvasadoApi(
  session: OrdersClientSession,
  envasado: UpsertGranelFromEnvasadoInput
): Promise<{ record: GranelRemainderRecord; created: boolean; duplicated: boolean }> {
  const res = await fetch("/api/v1/deposito-graneles", {
    method: "POST",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify({ action: "upsertFromEnvasado", actorSectorId: session.sector, envasado }),
  });
  const body = (await res.json()) as {
    record?: GranelRemainderRecord;
    created?: boolean;
    duplicated?: boolean;
    error?: string;
  };
  if (!res.ok) throw new Error(body.error ?? "No se pudo registrar el sobrante de granel.");
  return { record: body.record!, created: Boolean(body.created), duplicated: Boolean(body.duplicated) };
}

export async function updateGranelApi(
  session: OrdersClientSession,
  id: string,
  patch: UpdateGranelPatch,
  reason?: string
): Promise<GranelRemainderRecord> {
  const res = await fetch(`/api/v1/deposito-graneles/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify({ actorSectorId: session.sector, patch, reason }),
  });
  const body = (await res.json()) as { record?: GranelRemainderRecord; error?: string };
  if (!res.ok) throw new Error(body.error ?? "No se pudo actualizar el sobrante.");
  return body.record!;
}

export async function deleteOrAnnulGranelApi(
  session: OrdersClientSession,
  id: string,
  reason?: string
): Promise<{ action: "eliminar" | "anular" }> {
  const res = await fetch(`/api/v1/deposito-graneles/${id}`, {
    method: "DELETE",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify({ actorSectorId: session.sector, reason }),
  });
  const body = (await res.json()) as { action?: "eliminar" | "anular"; error?: string };
  if (!res.ok) throw new Error(body.error ?? "No se pudo eliminar el sobrante.");
  return { action: body.action ?? "eliminar" };
}
