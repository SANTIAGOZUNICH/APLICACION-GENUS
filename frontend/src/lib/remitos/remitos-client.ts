import {
  ACTOR_EMAIL_HEADER,
  ACTOR_SECTOR_HEADER,
} from "@/lib/orders/actor";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import type {
  RemitoApprovalInput,
  RemitoDraftPatch,
  RemitoEditGeneratedOptions,
  RemitoGenerateOptions,
  RemitoListFilters,
  RemitoRecord,
  RemitoUpsertResult,
  RemitoVersionInfo,
  RemitoWorkItemStatus,
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
  extra?: Record<string, unknown>
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

export async function updateRemitoDraftApi(
  session: OrdersClientSession,
  remitoId: string,
  patch: RemitoDraftPatch
): Promise<RemitoRecord> {
  return remitoActionApi(session, "update_draft", remitoId, { patch });
}

export async function generateRemitoApi(
  session: OrdersClientSession,
  remitoId: string,
  options: RemitoGenerateOptions
): Promise<RemitoRecord> {
  return remitoActionApi(session, "generate", remitoId, options);
}

export async function renameRemitoApi(
  session: OrdersClientSession,
  remitoId: string,
  displayName: string
): Promise<RemitoRecord> {
  return remitoActionApi(session, "rename", remitoId, { displayName });
}

export async function editGeneratedRemitoApi(
  session: OrdersClientSession,
  remitoId: string,
  options: RemitoEditGeneratedOptions
): Promise<RemitoRecord> {
  return remitoActionApi(session, "edit_generated", remitoId, options);
}

export async function remitoStatusForWorkApi(
  session: OrdersClientSession,
  workItemId: string
): Promise<RemitoWorkItemStatus> {
  const res = await fetch("/api/v1/remitos", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ action: "status_for_work", workItemId }),
  });
  const body = (await res.json()) as RemitoWorkItemStatus & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "No se pudo consultar estado de remito");
  return { status: body.status, remitoId: body.remitoId ?? null };
}

export async function listRemitoVersionsApi(
  session: OrdersClientSession,
  remitoId: string
): Promise<RemitoVersionInfo[]> {
  const res = await fetch(`/api/v1/remitos/${remitoId}`, {
    method: "PATCH",
    headers: headers(session),
    body: JSON.stringify({ action: "list_versions" }),
  });
  const body = (await res.json()) as {
    versions?: RemitoVersionInfo[];
    remito?: RemitoRecord;
    error?: string;
  };
  if (!res.ok) throw new Error(body.error ?? "No se pudieron listar versiones");
  return body.versions ?? body.remito?.versions ?? [];
}

export function remitoDownloadUrl(
  remitoId: string,
  format: "pdf" | "xlsx",
  opts?: { filename?: string; version?: number }
): string {
  const qs = new URLSearchParams({ format });
  if (opts?.filename) qs.set("filename", opts.filename);
  if (opts?.version != null) qs.set("version", String(opts.version));
  return `/api/v1/remitos/${remitoId}/download?${qs}`;
}
