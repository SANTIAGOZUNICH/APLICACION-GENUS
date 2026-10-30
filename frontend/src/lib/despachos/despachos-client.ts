/** Cliente de navegador — Depósito «Entregas Producción» (API Neon, migración 0073). */
import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import type { DespachoCellChange } from "./cell-edit";
import type { CreateDespachoInput, DespachoAuditEntry, DespachoRecord } from "./types";

const BASE = "/api/v1/deposito-despachos";

function headers(s: OrdersClientSession): HeadersInit {
  return { "Content-Type": "application/json", [ACTOR_EMAIL_HEADER]: s.email, [ACTOR_SECTOR_HEADER]: s.sector };
}

export async function fetchDespachosApi(s: OrdersClientSession): Promise<DespachoRecord[]> {
  const res = await fetch(BASE, { credentials: "include", headers: headers(s) });
  const body = (await res.json().catch(() => ({}))) as { items?: DespachoRecord[]; error?: string };
  if (!res.ok) throw new Error(body.error ?? "No se pudieron cargar las entregas a Producción.");
  return body.items ?? [];
}

/** Alta de una fila. La `idempotencyKey` hace seguro el reintento / doble clic. */
export async function createDespachoApi(s: OrdersClientSession, record: CreateDespachoInput): Promise<{ record: DespachoRecord; created: boolean }> {
  const res = await fetch(BASE, { method: "POST", credentials: "include", headers: headers(s), body: JSON.stringify({ record }) });
  const body = (await res.json().catch(() => ({}))) as { record?: DespachoRecord; created?: boolean; error?: string };
  if (!res.ok || !body.record) throw new Error(body.error ?? "No se pudo registrar la entrega.");
  return { record: body.record, created: Boolean(body.created) };
}

export type CreateManyResult = Array<{ ok: true; record: DespachoRecord; created: boolean } | { ok: false; message: string }>;

export async function createDespachosApi(s: OrdersClientSession, records: CreateDespachoInput[], batchKey: string): Promise<CreateManyResult> {
  const res = await fetch(BASE, { method: "POST", credentials: "include", headers: headers(s), body: JSON.stringify({ records, batchKey }) });
  const body = (await res.json().catch(() => ({}))) as { results?: CreateManyResult; error?: string };
  if (!res.ok || !body.results) throw new Error(body.error ?? "No se pudieron importar las entregas.");
  return body.results;
}

export interface DespachoCellApiResult {
  ok: boolean;
  results: Array<{ ok: boolean; message?: string; code?: string }>;
  error?: string;
}

export async function patchDespachoCellsApi(s: OrdersClientSession, changes: DespachoCellChange[]): Promise<DespachoCellApiResult> {
  const res = await fetch(`${BASE}/cells`, { method: "PATCH", credentials: "include", headers: headers(s), body: JSON.stringify({ changes }) });
  const body = (await res.json().catch(() => ({}))) as Partial<DespachoCellApiResult>;
  if (!body.results) return { ok: false, results: [], error: body.error ?? `Error ${res.status} al guardar.` };
  return { ok: Boolean(body.ok), results: body.results, error: body.error };
}

export interface DespachoBulkDeleteResult {
  requested: number;
  deleted: string[];
  skipped: string[];
  failed: Array<{ id: string; message: string }>;
}

export async function bulkDeleteDespachosApi(s: OrdersClientSession, target: { ids: string[] } | { all: true }): Promise<DespachoBulkDeleteResult> {
  const res = await fetch(`${BASE}/bulk-delete`, {
    method: "POST",
    credentials: "include",
    headers: headers(s),
    body: JSON.stringify("all" in target ? { scope: "all" } : { ids: target.ids }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<DespachoBulkDeleteResult> & { error?: string };
  if (!res.ok || !body.deleted) throw new Error(body.error ?? "No se pudo eliminar.");
  return body as DespachoBulkDeleteResult;
}

export async function fetchDespachoHistoryApi(s: OrdersClientSession, id: string): Promise<DespachoAuditEntry[]> {
  const res = await fetch(`${BASE}/${id}?history=1`, { credentials: "include", headers: headers(s) });
  const body = (await res.json().catch(() => ({}))) as { history?: DespachoAuditEntry[]; error?: string };
  if (!res.ok) throw new Error(body.error ?? "No se pudo cargar el historial.");
  return body.history ?? [];
}
