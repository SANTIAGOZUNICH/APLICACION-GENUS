import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import type { DashboardFilters, DashboardPayload, DashboardTarget } from "./types";

function headers(session: OrdersClientSession): HeadersInit {
  return {
    "Content-Type": "application/json",
    [ACTOR_EMAIL_HEADER]: session.email,
    [ACTOR_SECTOR_HEADER]: session.sector,
  };
}

export async function fetchDashboardApi(
  session: OrdersClientSession,
  filters: Partial<DashboardFilters>,
  signal?: AbortSignal
): Promise<DashboardPayload> {
  const qs = new URLSearchParams();
  if (filters.year) qs.set("year", String(filters.year));
  if (filters.month) qs.set("month", String(filters.month));
  if (filters.sector && filters.sector !== "ALL") qs.set("sector", filters.sector);
  if (filters.client) qs.set("client", filters.client);
  const res = await fetch(`/api/v1/dashboard?${qs}`, { credentials: "include", headers: headers(session), signal });
  const body = (await res.json().catch(() => ({}))) as DashboardPayload & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "No se pudo cargar el Dashboard");
  return body;
}

export async function saveDashboardTargetApi(
  session: OrdersClientSession,
  input: { key: string; value: number; direction: "min" | "max" }
): Promise<DashboardTarget> {
  const res = await fetch("/api/v1/dashboard/targets", {
    method: "PUT",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as { target?: DashboardTarget; error?: string };
  if (!res.ok || !body.target) throw new Error(body.error ?? "No se pudo guardar el objetivo");
  return body.target;
}

export async function clearDashboardTargetApi(session: OrdersClientSession, key: string): Promise<void> {
  const res = await fetch(`/api/v1/dashboard/targets?key=${encodeURIComponent(key)}`, {
    method: "DELETE",
    credentials: "include",
    headers: headers(session),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? "No se pudo quitar el objetivo");
}
