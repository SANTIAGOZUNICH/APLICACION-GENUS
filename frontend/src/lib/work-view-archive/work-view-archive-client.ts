import {
  ACTOR_EMAIL_HEADER,
  ACTOR_SECTOR_HEADER,
} from "@/lib/orders/actor";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import type {
  WorkViewArchiveRecord,
  WorkViewArchiveSector,
} from "./types";

function headers(session: OrdersClientSession): HeadersInit {
  return {
    "Content-Type": "application/json",
    [ACTOR_EMAIL_HEADER]: session.email,
    [ACTOR_SECTOR_HEADER]: session.sector,
  };
}

export async function fetchWorkViewArchivesApi(
  session: OrdersClientSession,
  sector: WorkViewArchiveSector
): Promise<{ archives: WorkViewArchiveRecord[]; workItemIds: string[]; schemaPending: boolean }> {
  const qs = new URLSearchParams({ sector });
  const res = await fetch(`/api/v1/work-view-archive?${qs}`, {
    headers: headers(session),
  });
  const body = (await res.json()) as {
    archives?: WorkViewArchiveRecord[];
    workItemIds?: string[];
    error?: string;
    schemaPending?: boolean;
  };
  if (!res.ok) throw new Error(body.error ?? "No se pudieron cargar archivados de vista");
  return {
    archives: body.archives ?? [],
    workItemIds: body.workItemIds ?? (body.archives ?? []).map((a) => a.workItemId),
    schemaPending: Boolean(body.schemaPending),
  };
}

export async function archiveFromViewApi(
  session: OrdersClientSession,
  sector: WorkViewArchiveSector,
  workItemId: string
): Promise<WorkViewArchiveRecord> {
  const res = await fetch("/api/v1/work-view-archive", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ action: "archive", sector, workItemId }),
  });
  const body = (await res.json()) as {
    archive?: WorkViewArchiveRecord;
    error?: string;
  };
  if (!res.ok) throw new Error(body.error ?? "No se pudo archivar de la vista");
  return body.archive!;
}

export async function restoreToViewApi(
  session: OrdersClientSession,
  sector: WorkViewArchiveSector,
  workItemId: string
): Promise<void> {
  const res = await fetch("/api/v1/work-view-archive", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ action: "restore", sector, workItemId }),
  });
  const body = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? "No se pudo restaurar a la vista");
}
