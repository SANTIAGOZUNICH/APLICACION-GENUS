import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import type { WorkItem } from "@/types/operational/work-item";

export type CodificadoHandoffAction = "send" | "resend" | "cancel" | "deliver";

export type CodificadoHandoffResult = {
  ok: true;
  replayed: boolean;
  operationId: string;
  workItem: WorkItem;
};

function authHeaders(session: {
  email?: string | null;
  sector?: string | null;
  cookie?: string | null;
}): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (session.cookie) headers.Cookie = session.cookie;
  if (session.email) headers[ACTOR_EMAIL_HEADER] = session.email;
  if (session.sector) headers[ACTOR_SECTOR_HEADER] = session.sector;
  return headers;
}

export async function postCodificadoHandoff(
  session: { email?: string | null; sector?: string | null; cookie?: string | null },
  workItemId: string,
  body: {
    action: CodificadoHandoffAction;
    totalUnits?: number;
    observation?: string | null;
    packagingLote?: string | null;
    packagingVto?: string | null;
    packagingTotalUnits?: number | null;
    packingGroups?: unknown;
    bulkRemainderKg?: number | null;
    bulkRemainderObservation?: string | null;
    bulkRemainderId?: string | null;
    reason?: string | null;
    forceWithdrawDelivery?: boolean;
    expectedVersion?: number | null;
    idempotencyKey: string;
  }
): Promise<CodificadoHandoffResult> {
  const id = workItemId.startsWith("native:")
    ? workItemId.slice("native:".length)
    : workItemId;
  const res = await fetch(`/api/v1/work-items/${encodeURIComponent(id)}/codificado`, {
    method: "POST",
    credentials: "include",
    headers: authHeaders(session),
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    replayed?: boolean;
    operationId?: string;
    workItem?: WorkItem;
  };
  if (!res.ok || !json.ok || !json.workItem) {
    throw new Error(json.error || `No se pudo completar la acción (${res.status}).`);
  }
  return {
    ok: true,
    replayed: Boolean(json.replayed),
    operationId: String(json.operationId ?? ""),
    workItem: json.workItem,
  };
}
