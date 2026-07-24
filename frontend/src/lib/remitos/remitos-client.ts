import {
  ACTOR_EMAIL_HEADER,
  ACTOR_SECTOR_HEADER,
} from "@/lib/orders/actor";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import type {
  RemitoApprovalInput,
  RemitoListFilters,
  RemitoRecord,
  RemitoUpsertResult,
} from "@/lib/remitos/types";

function headers(session: OrdersClientSession): HeadersInit {
  return {
    "Content-Type": "application/json",
    [ACTOR_EMAIL_HEADER]: session.email,
    [ACTOR_SECTOR_HEADER]: session.sector,
  };
}

export async function fetchRemitosApi(
  session: OrdersClientSession,
  filters: RemitoListFilters = {}
): Promise<{ remitos: RemitoRecord[]; schemaPending: boolean }> {
  const qs = new URLSearchParams();
  if (filters.tab) qs.set("tab", filters.tab);
  if (filters.q) qs.set("q", filters.q);
  if (filters.clientId) qs.set("clientId", filters.clientId);
  if (filters.deliveryDate) qs.set("deliveryDate", filters.deliveryDate);
  if (filters.status) qs.set("status", filters.status);
  const res = await fetch(`/api/v1/remitos?${qs}`, { headers: headers(session) });
  const body = (await res.json()) as {
    remitos?: RemitoRecord[];
    error?: string;
    schemaPending?: boolean;
  };
  if (!res.ok) throw new Error(body.error ?? "No se pudieron cargar remitos");
  return {
    remitos: body.remitos ?? [],
    schemaPending: Boolean(body.schemaPending),
  };
}

export async function remitoActionApi(
  session: OrdersClientSession,
  action: string,
  remitoId: string,
  extra?: { extraLines?: RemitoApprovalInput[] }
): Promise<RemitoRecord> {
  const res = await fetch(`/api/v1/remitos/${remitoId}`, {
    method: "PATCH",
    headers: headers(session),
    body: JSON.stringify({ action, ...extra }),
  });
  const body = (await res.json()) as { remito?: RemitoRecord; error?: string };
  if (!res.ok) throw new Error(body.error ?? "Acción de remito falló");
  return body.remito!;
}

export async function upsertRemitoDraftApi(
  session: OrdersClientSession,
  input: RemitoApprovalInput
): Promise<RemitoUpsertResult> {
  const res = await fetch("/api/v1/remitos", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ action: "upsert_draft", input }),
  });
  const body = (await res.json()) as RemitoUpsertResult & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "No se pudo actualizar borrador");
  return body;
}

export function remitoDownloadUrl(
  remitoId: string,
  format: "pdf" | "xlsx",
  filename?: string
): string {
  const qs = new URLSearchParams({ format });
  if (filename) qs.set("filename", filename);
  return `/api/v1/remitos/${remitoId}/download?${qs}`;
}
