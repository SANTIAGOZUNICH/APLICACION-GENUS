import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import type { CalendarWeek } from "./calendar-model";
import type { FlatTable } from "./flat-model";
import type { PrioritiesPayload } from "./priorities";
import type { PlanSector, PlanTask } from "./plan-tasks";
import type { LinkCandidate, LinkEventDto, LinkView, TaskLinksPayload, WorkItemPrioritiesPayload } from "./task-links";
import type { SemanasTabKey } from "./semanas-tabs";

function headers(session: OrdersClientSession): HeadersInit {
  return { "Content-Type": "application/json", [ACTOR_EMAIL_HEADER]: session.email, [ACTOR_SECTOR_HEADER]: session.sector };
}

export interface SemanasViewResponse {
  spreadsheetId: string;
  tabKey: SemanasTabKey;
  tab: string;
  label: string;
  kind: "CALENDAR" | "FLAT";
  source?: "GOOGLE" | "PREVIEW_XLSX" | "LOCAL_FIXTURE";
  writable: boolean;
  /** Por qué no se escribe en la planilla (null si se puede). */
  writeBlockReason?: string | null;
  canEdit: boolean;
  weeks?: CalendarWeek[];
  /** Ancho (px) de Lun..Vie en la Sheet original. */
  dayWidths?: number[];
  /** Prioridades guardadas en GENUS (por clave de tarea). */
  priorities?: PrioritiesPayload;
  /** Vínculos con trabajos operativos (solo Producción). */
  links?: TaskLinksPayload;
  /** Producción puede vincular (hay planificación nativa y migración 0042). */
  canLink?: boolean;
  table?: FlatTable;
  readAt: string;
  /** "Hoy" que usa el servidor para decidir períodos cerrados. */
  today?: string;
  locksKnown?: boolean;
  reasonRequiredBefore?: string;
}

export async function fetchSemanasView(session: OrdersClientSession, tab: SemanasTabKey): Promise<SemanasViewResponse> {
  const res = await fetch(`/api/v1/semanas/grid?tab=${tab}`, { credentials: "include", headers: headers(session) });
  const body = (await res.json().catch(() => ({}))) as SemanasViewResponse & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "No se pudo leer SEMANAS 2026.");
  return body;
}

export interface SemanasEditPayload {
  tabKey: SemanasTabKey;
  a1: string;
  expectedValue: string;
  value: string;
  reason?: string;
}
export interface SemanasEditResultDto {
  ok: boolean;
  code?: string;
  message?: string;
}

/** Resultado por celda, en el mismo orden que `edits`. Lanza solo ante errores de red. */
export async function patchSemanasCells(
  session: OrdersClientSession,
  edits: SemanasEditPayload[]
): Promise<{ ok: boolean; results: SemanasEditResultDto[]; error?: string }> {
  let res: Response;
  try {
    res = await fetch("/api/v1/semanas/cells", { method: "PATCH", credentials: "include", headers: headers(session), body: JSON.stringify({ edits }) });
  } catch {
    return { ok: false, results: edits.map(() => ({ ok: false, message: "Sin conexión con el servidor." })), error: "Sin conexión con el servidor." };
  }
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; results?: SemanasEditResultDto[]; error?: string };
  return {
    ok: Boolean(res.ok && body.ok),
    results: body.results ?? edits.map(() => ({ ok: false, message: body.error ?? "No se pudo guardar." })),
    error: body.error,
  };
}

export interface PreviewSourceStatus {
  origin: "UPLOADED_STORAGE" | "UPLOADED_MEMORY" | "BUNDLED";
  persisted: boolean;
  storageConfigured: boolean;
  sha256: string;
  bytes: number;
  sheets: string[];
  weeks: Record<string, number>;
}

async function previewCall(session: OrdersClientSession, init: RequestInit): Promise<{ status?: PreviewSourceStatus; persisted?: boolean; error?: string }> {
  const res = await fetch("/api/v1/semanas/preview-source", { credentials: "include", ...init, headers: { ...headers(session), ...(init.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as { status?: PreviewSourceStatus; persisted?: boolean; error?: string };
  if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
  return body;
}
export const fetchPreviewSource = (s: OrdersClientSession) => previewCall(s, {});
export const resetPreviewSource = (s: OrdersClientSession) => previewCall(s, { method: "DELETE" });
export function uploadPreviewSource(s: OrdersClientSession, file: File) {
  const form = new FormData();
  form.append("file", file);
  // multipart: el navegador fija el Content-Type (con boundary); solo van los headers de identidad.
  const h = headers(s) as Record<string, string>;
  delete h["Content-Type"];
  return fetch("/api/v1/semanas/preview-source", { method: "POST", credentials: "include", headers: h, body: form }).then(async (res) => {
    const body = (await res.json().catch(() => ({}))) as { status?: PreviewSourceStatus; persisted?: boolean; error?: string };
    if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
    return body;
  });
}

export interface StoredPriorityDto {
  priority: "URGENTE" | "IMPORTANTE" | "NORMAL";
  version: number;
  updatedBy: string;
  updatedByName: string;
  updatedAt: string;
}

/** Cambia la prioridad de una tarea (dato de GENUS; no escribe en la Sheet). Lanza con el motivo real si no se guardó. */
export async function patchTaskPriority(
  session: OrdersClientSession,
  body: { tabKey: SemanasTabKey; taskKey: string; priority: string; expectedVersion: number }
): Promise<StoredPriorityDto> {
  const res = await fetch("/api/v1/semanas/priorities", { method: "PATCH", credentials: "include", headers: headers(session), body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { stored?: StoredPriorityDto; error?: string };
  if (!res.ok || !json.stored) throw new Error(json.error ?? `No se pudo guardar la prioridad (${res.status}).`);
  return json.stored;
}

export interface SectorPlanResponse {
  sectors: PlanSector[];
  allowed: PlanSector[];
  weeks: Array<{ id: string; label: string; dates: (string | null)[]; hidden: boolean; tabKey: PlanTask["tabKey"] }>;
  tasks: PlanTask[];
  prioritiesAvailable: boolean;
  source: "GOOGLE" | "PREVIEW_XLSX" | "LOCAL_FIXTURE";
  readAt: string;
  today: string;
}

/** Planificación de Semanas de un sector (solo lectura). El servidor decide qué sectores se pueden ver. */
export async function fetchSectorPlan(session: OrdersClientSession, sector?: PlanSector | "ALL"): Promise<SectorPlanResponse> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/semanas/plan${sector ? `?sector=${sector}` : ""}`, { credentials: "include", headers: headers(session) });
  } catch {
    throw new Error("Sin conexión con el servidor.");
  }
  const body = (await res.json().catch(() => ({}))) as SectorPlanResponse & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `No se pudo leer la planificación (${res.status}).`);
  return body;
}

export interface PriorityEventDto {
  from: "URGENTE" | "IMPORTANTE" | "NORMAL";
  to: "URGENTE" | "IMPORTANTE" | "NORMAL";
  actorEmail: string;
  actorName: string;
  actorSector: string;
  at: string;
}
export interface TaskHistory {
  events: PriorityEventDto[];
  linkEvents: LinkEventDto[];
}
export async function fetchPriorityHistory(session: OrdersClientSession, tabKey: SemanasTabKey, taskKey: string): Promise<TaskHistory> {
  const res = await fetch(`/api/v1/semanas/priorities?tabKey=${tabKey}&taskKey=${encodeURIComponent(taskKey)}`, { credentials: "include", headers: headers(session) });
  const body = (await res.json().catch(() => ({}))) as Partial<TaskHistory> & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `No se pudo leer el historial (${res.status}).`);
  return { events: body.events ?? [], linkEvents: body.linkEvents ?? [] };
}

// ---------- vínculos tarea de Semanas ↔ trabajo operativo ----------
async function jsonCall<T>(session: OrdersClientSession, url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "include", ...init, headers: { ...headers(session), ...(init.headers ?? {}) } });
  } catch {
    throw new Error("Sin conexión con el servidor.");
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
  return body;
}

export interface LinkSuggestionsDto {
  candidates: LinkCandidate[];
  linkedElsewhere: Array<LinkCandidate & { link: { linkId: string; version: number; taskKey: string; summary: string } }>;
}
export function fetchLinkCandidates(session: OrdersClientSession, tabKey: SemanasTabKey, taskKey: string): Promise<LinkSuggestionsDto> {
  return jsonCall(session, `/api/v1/semanas/links/candidates?tabKey=${tabKey}&taskKey=${encodeURIComponent(taskKey)}`);
}
export function postTaskLink(
  session: OrdersClientSession,
  body: { tabKey: SemanasTabKey; taskKey: string; workItemId: string; replace?: { linkId: string; expectedVersion: number }; reason?: string }
): Promise<{ link: LinkView }> {
  return jsonCall(session, "/api/v1/semanas/links", { method: "POST", body: JSON.stringify(body) });
}
export function deleteTaskLink(session: OrdersClientSession, body: { linkId: string; expectedVersion: number; reason: string }): Promise<{ ok: boolean }> {
  return jsonCall(session, "/api/v1/semanas/links", { method: "DELETE", body: JSON.stringify(body) });
}
export function fetchWorkItemPriorities(session: OrdersClientSession): Promise<WorkItemPrioritiesPayload & { error?: string }> {
  return jsonCall(session, "/api/v1/semanas/work-item-priorities");
}
