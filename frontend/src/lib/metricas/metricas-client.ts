import {
  ACTOR_EMAIL_HEADER,
  ACTOR_SECTOR_HEADER,
} from "@/lib/orders/actor";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import type {
  MetricsListFilters,
  MetricsRankingEntry,
  PackagingMetricRecord,
} from "./types";

function headers(session: OrdersClientSession): HeadersInit {
  return {
    "Content-Type": "application/json",
    [ACTOR_EMAIL_HEADER]: session.email,
    [ACTOR_SECTOR_HEADER]: session.sector,
  };
}

export async function fetchMetricasApi(
  session: OrdersClientSession,
  filters: MetricsListFilters = {}
): Promise<{
  metrics: PackagingMetricRecord[];
  ranking: MetricsRankingEntry[];
  totals: { totalUnits: number; recordCount: number };
  schemaPending: boolean;
}> {
  const qs = new URLSearchParams();
  if (filters.dateFrom) qs.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) qs.set("dateTo", filters.dateTo);
  if (filters.product) qs.set("product", filters.product);
  if (filters.responsible) qs.set("responsible", filters.responsible);
  if (filters.sector) qs.set("sector", filters.sector);
  const res = await fetch(`/api/v1/metricas?${qs}`, { headers: headers(session) });
  const body = (await res.json()) as {
    metrics?: PackagingMetricRecord[];
    ranking?: MetricsRankingEntry[];
    totals?: { totalUnits: number; recordCount: number };
    schemaPending?: boolean;
    error?: string;
  };
  if (!res.ok) throw new Error(body.error ?? "Error al cargar métricas");
  return {
    metrics: body.metrics ?? [],
    ranking: body.ranking ?? [],
    totals: body.totals ?? { totalUnits: 0, recordCount: 0 },
    schemaPending: Boolean(body.schemaPending),
  };
}

export async function metricasActionApi(
  session: OrdersClientSession,
  action: string,
  payload: Record<string, unknown> = {}
): Promise<unknown> {
  const res = await fetch("/api/v1/metricas", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ action, ...payload }),
  });
  const body = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? "Acción fallida");
  return body;
}
