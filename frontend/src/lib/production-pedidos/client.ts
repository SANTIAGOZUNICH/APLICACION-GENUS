import {
  ACTOR_EMAIL_HEADER,
  ACTOR_SECTOR_HEADER,
} from "@/lib/auth/header-names";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import type {
  ProductionPedidoInput,
  ProductionPedidoListFilters,
  ProductionPedidoRecord,
} from "./types";
import type { ColumnAssociation, ParseExcelPasteResult } from "./excel-paste";

function headers(session: OrdersClientSession): HeadersInit {
  return {
    "Content-Type": "application/json",
    [ACTOR_EMAIL_HEADER]: session.email,
    [ACTOR_SECTOR_HEADER]: session.sector,
  };
}

function publicError(body: { error?: string }, fallback: string): string {
  const msg = body.error ?? fallback;
  if (/failed query|sql|syntax|postgres|neon|stack/i.test(msg)) {
    return "No se pudo completar la operación. Intentá de nuevo.";
  }
  return msg;
}

export async function fetchProductionPedidosApi(
  session: OrdersClientSession,
  filters: ProductionPedidoListFilters = {}
): Promise<{ items: ProductionPedidoRecord[]; schemaPending: boolean }> {
  const qs = new URLSearchParams();
  if (filters.op) qs.set("op", filters.op);
  if (filters.nroOc) qs.set("nroOc", filters.nroOc);
  if (filters.cliente) qs.set("cliente", filters.cliente);
  if (filters.producto) qs.set("producto", filters.producto);
  if (filters.estado) qs.set("estado", filters.estado);
  if (filters.fechaFrom) qs.set("fechaFrom", filters.fechaFrom);
  if (filters.fechaTo) qs.set("fechaTo", filters.fechaTo);
  const res = await fetch(`/api/v1/production-pedidos?${qs}`, {
    credentials: "include",
    headers: headers(session),
  });
  const body = (await res.json()) as {
    items?: ProductionPedidoRecord[];
    error?: string;
    schemaPending?: boolean;
  };
  if (!res.ok) throw new Error(publicError(body, "No se pudieron cargar pedidos"));
  return { items: body.items ?? [], schemaPending: Boolean(body.schemaPending) };
}

export async function createProductionPedidoApi(
  session: OrdersClientSession,
  input: ProductionPedidoInput
): Promise<ProductionPedidoRecord> {
  const res = await fetch("/api/v1/production-pedidos", {
    method: "POST",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify(input),
  });
  const body = (await res.json()) as { item?: ProductionPedidoRecord; error?: string };
  if (!res.ok) throw new Error(publicError(body, "No se pudo crear el pedido"));
  return body.item!;
}

export async function updateProductionPedidoApi(
  session: OrdersClientSession,
  id: string,
  input: ProductionPedidoInput
): Promise<ProductionPedidoRecord> {
  const res = await fetch(`/api/v1/production-pedidos/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify(input),
  });
  const body = (await res.json()) as { item?: ProductionPedidoRecord; error?: string };
  if (!res.ok) throw new Error(publicError(body, "No se pudo actualizar el pedido"));
  return body.item!;
}

export async function deleteProductionPedidoApi(
  session: OrdersClientSession,
  id: string,
  reason: string
): Promise<ProductionPedidoRecord> {
  const res = await fetch(`/api/v1/production-pedidos/${id}`, {
    method: "DELETE",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify({ reason }),
  });
  const body = (await res.json()) as { item?: ProductionPedidoRecord; error?: string };
  if (!res.ok) throw new Error(publicError(body, "No se pudo eliminar el pedido"));
  return body.item!;
}

export type ImportResult = {
  created: ProductionPedidoRecord[];
  inserted: number;
  rejected: number;
  duplicateWarnings: number;
  idempotentReplay: boolean;
};

export async function importProductionPedidosApi(
  session: OrdersClientSession,
  rows: ProductionPedidoInput[],
  idempotencyKey: string
): Promise<ImportResult> {
  const res = await fetch("/api/v1/production-pedidos/import", {
    method: "POST",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify({ rows, confirm: true, idempotencyKey }),
  });
  const body = (await res.json()) as ImportResult & { error?: string; skipped?: number };
  if (!res.ok) throw new Error(publicError(body, "No se pudo importar"));
  return {
    created: body.created ?? [],
    inserted: body.inserted ?? body.created?.length ?? 0,
    rejected: body.rejected ?? body.skipped ?? 0,
    duplicateWarnings: body.duplicateWarnings ?? 0,
    idempotentReplay: Boolean(body.idempotentReplay),
  };
}

export async function previewProductionPedidosPasteApi(
  session: OrdersClientSession,
  text: string,
  opts?: { forcePosition?: boolean; fieldSourceOverrides?: Record<string, number> }
): Promise<ParseExcelPasteResult> {
  const res = await fetch("/api/v1/production-pedidos/paste-preview", {
    method: "POST",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify({
      text,
      forcePosition: opts?.forcePosition,
      fieldSourceOverrides: opts?.fieldSourceOverrides,
    }),
  });
  const body = (await res.json()) as ParseExcelPasteResult & { error?: string };
  if (!res.ok) throw new Error(publicError(body, "No se pudo parsear el pegado"));
  return {
    rows: body.rows ?? [],
    headerDetected: Boolean(body.headerDetected),
    mode: body.mode ?? (body.headerDetected ? "by-header" : "by-position"),
    associations: (body.associations ?? []) as ColumnAssociation[],
    ignoredHeaders: body.ignoredHeaders ?? [],
    missingFields: body.missingFields ?? [],
    validCount: body.validCount ?? (body.rows ?? []).filter((r) => r.valid).length,
    invalidCount: body.invalidCount ?? 0,
    summary: body.summary ?? "",
  };
}
