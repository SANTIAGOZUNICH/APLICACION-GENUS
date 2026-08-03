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

function headers(session: OrdersClientSession): HeadersInit {
  return {
    "Content-Type": "application/json",
    [ACTOR_EMAIL_HEADER]: session.email,
    [ACTOR_SECTOR_HEADER]: session.sector,
  };
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
  if (!res.ok) throw new Error(body.error ?? "No se pudieron cargar pedidos");
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
  if (!res.ok) throw new Error(body.error ?? "No se pudo crear el pedido");
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
  if (!res.ok) throw new Error(body.error ?? "No se pudo actualizar el pedido");
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
  if (!res.ok) throw new Error(body.error ?? "No se pudo eliminar el pedido");
  return body.item!;
}

export async function importProductionPedidosApi(
  session: OrdersClientSession,
  rows: ProductionPedidoInput[]
): Promise<{ created: ProductionPedidoRecord[]; skipped: number }> {
  const res = await fetch("/api/v1/production-pedidos/import", {
    method: "POST",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify({ rows, confirm: true }),
  });
  const body = (await res.json()) as {
    created?: ProductionPedidoRecord[];
    skipped?: number;
    error?: string;
  };
  if (!res.ok) throw new Error(body.error ?? "No se pudo importar");
  return { created: body.created ?? [], skipped: body.skipped ?? 0 };
}

export async function previewProductionPedidosPasteApi(
  session: OrdersClientSession,
  text: string
): Promise<{
  rows: Array<{
    rowIndex: number;
    op: string | null;
    fecha: string | null;
    nroOc: string | null;
    cliente: string | null;
    producto: string | null;
    s: string | null;
    q: number | null;
    ml: number | null;
    kg: number | null;
    estado: string | null;
    errors: string[];
    warnings: string[];
    valid: boolean;
  }>;
  headerDetected: boolean;
}> {
  const res = await fetch("/api/v1/production-pedidos/paste-preview", {
    method: "POST",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify({ text }),
  });
  const body = (await res.json()) as {
    rows?: Array<{
      rowIndex: number;
      op: string | null;
      fecha: string | null;
      nroOc: string | null;
      cliente: string | null;
      producto: string | null;
      s: string | null;
      q: number | null;
      ml: number | null;
      kg: number | null;
      estado: string | null;
      errors: string[];
      warnings: string[];
      valid: boolean;
    }>;
    headerDetected?: boolean;
    error?: string;
  };
  if (!res.ok) throw new Error(body.error ?? "No se pudo parsear el pegado");
  return { rows: body.rows ?? [], headerDetected: Boolean(body.headerDetected) };
}
