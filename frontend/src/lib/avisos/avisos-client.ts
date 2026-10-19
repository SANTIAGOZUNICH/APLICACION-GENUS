import {
  ACTOR_EMAIL_HEADER,
  ACTOR_SECTOR_HEADER,
} from "@/lib/auth/header-names";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import type { AvisoRecord, AvisoTab, CreateAvisoInput } from "@/lib/avisos/types";

function headers(session: OrdersClientSession): HeadersInit {
  return {
    "Content-Type": "application/json",
    [ACTOR_EMAIL_HEADER]: session.email,
    [ACTOR_SECTOR_HEADER]: session.sector,
  };
}

export async function fetchAvisosApi(
  session: OrdersClientSession,
  tab: AvisoTab,
  q = ""
): Promise<{ messages: AvisoRecord[]; schemaPending: boolean }> {
  const qs = new URLSearchParams({ tab, q });
  const res = await fetch(`/api/v1/avisos?${qs}`, { credentials: "include", headers: headers(session) });
  const body = (await res.json()) as {
    messages?: AvisoRecord[];
    error?: string;
    schemaPending?: boolean;
  };
  if (!res.ok) throw new Error(body.error ?? "No se pudieron cargar avisos");
  return {
    messages: body.messages ?? [],
    schemaPending: Boolean(body.schemaPending),
  };
}

export async function createAvisoApi(
  session: OrdersClientSession,
  input: CreateAvisoInput
): Promise<AvisoRecord> {
  const res = await fetch("/api/v1/avisos", {
    method: "POST",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify({ ...input, confirm: true }),
  });
  const body = (await res.json()) as { message?: AvisoRecord; error?: string };
  if (!res.ok) throw new Error(body.error ?? "No se pudo enviar el aviso");
  return body.message!;
}

export async function patchAvisoApi(
  session: OrdersClientSession,
  id: string,
  action: "read" | "archive" | "restore"
): Promise<AvisoRecord> {
  const res = await fetch(`/api/v1/avisos/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify({ action }),
  });
  const body = (await res.json()) as { message?: AvisoRecord; error?: string };
  if (!res.ok) throw new Error(body.error ?? "No se pudo actualizar el aviso");
  return body.message!;
}

export type AvisoDirectoryEntry = { email: string; name: string; sector: string; roleLabel: string; responsable: boolean };

/** Personas a las que se puede dirigir un aviso. */
export async function fetchAvisoDirectoryApi(session: OrdersClientSession): Promise<AvisoDirectoryEntry[]> {
  const res = await fetch("/api/v1/avisos/directory", { credentials: "include", headers: headers(session), cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { users?: AvisoDirectoryEntry[]; error?: string };
  if (!res.ok) throw new Error(body.error ?? "No se pudo cargar la lista de personas");
  return body.users ?? [];
}
