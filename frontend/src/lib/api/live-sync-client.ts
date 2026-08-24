import { getCurrentAuthSession } from "@/features/os/auth/lib/auth-session-helpers";
import type {
  DeliveryMutationResult,
  DeliveryRecord,
} from "@/features/os/operational/adapters/delivery-repository";
import type { LiveSyncEvent, LiveSyncStatus } from "@/lib/live-sync/types";
import {
  ACTOR_EMAIL_HEADER,
  ACTOR_SECTOR_HEADER,
} from "@/lib/auth/header-names";
import type { SectorId } from "@/types/operational/sector";
import type { WorkItem } from "@/types/operational/work-item";

function jsonActorHeaders(): HeadersInit {
  const session = getCurrentAuthSession();
  return {
    "Content-Type": "application/json",
    ...(session
      ? {
          [ACTOR_EMAIL_HEADER]: session.user.email,
          [ACTOR_SECTOR_HEADER]: session.sector.id,
        }
      : {}),
  };
}

export async function fetchLiveSyncStatus(): Promise<LiveSyncStatus & { mode?: string }> {
  const response = await fetch("/api/v1/live-sync/status", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("No se pudo obtener estado Live Sync.");
  }
  return response.json() as Promise<LiveSyncStatus & { mode?: string }>;
}

export interface LiveSyncCheckResponse {
  changed: boolean;
  version: string;
  revision?: number;
  checkedAt: string;
  mode?: string;
  workItems?: WorkItem[];
  counts?: {
    total: number;
    hoy: number;
    semana: number;
    pendientes: number;
    bloqueados: number;
  };
  metrics?: Record<string, unknown>;
}

/** Poll liviano Sheet→app. Si changed, trae WorkItems en la misma respuesta. */
export async function fetchLiveSyncCheck(params: {
  sector: SectorId;
  knownVersion?: string | null;
  ownerPerson?: string | null;
  date?: string | null;
  weekStart?: string | null;
  signal?: AbortSignal;
}): Promise<LiveSyncCheckResponse> {
  const search = new URLSearchParams({ sector: params.sector });
  if (params.knownVersion) search.set("knownVersion", params.knownVersion);
  if (params.ownerPerson) search.set("ownerPerson", params.ownerPerson);
  if (params.date) search.set("date", params.date);
  if (params.weekStart) search.set("weekStart", params.weekStart);

  const response = await fetch(`/api/v1/live-sync/check?${search.toString()}`, {
    cache: "no-store",
    signal: params.signal,
  });

  if (response.status === 429) {
    throw new Error("RATE_LIMITED");
  }
  if (!response.ok) {
    throw new Error("No se pudo ejecutar live-sync check.");
  }

  return response.json() as Promise<LiveSyncCheckResponse>;
}

export function connectLiveSyncStream(
  sector: SectorId,
  onEvent: (event: LiveSyncEvent) => void,
  onError?: () => void
): () => void {
  const params = new URLSearchParams({ sector });
  const source = new EventSource(`/api/v1/live-sync/stream?${params.toString()}`);

  source.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data) as LiveSyncEvent;
      onEvent(event);
    } catch {
      // ignore malformed events
    }
  };

  source.onerror = () => {
    onError?.();
  };

  return () => source.close();
}

export async function postSaveProgress(payload: {
  itemId: string;
  sector?: SectorId;
  finishedQty: string;
  observation: string;
  updatedBy?: string;
  packagingLote?: string | null;
  packagingVto?: string | null;
  packagingTotalUnits?: number | null;
  packagingCajas?: number | null;
  packagingUnidadesPorCaja?: number | null;
  packingGroups?: Array<{ cajas: number; unidadesPorCaja: number }> | null;
  packingMismatchObservation?: string | null;
  /** Unidades producidas pero no entregables (PARTE A). */
  sampleUnits?: number | null;
}): Promise<void> {
  const response = await fetch("/api/v1/live-sync/operations", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "save_progress", ...payload }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ?? "No se pudo guardar el avance en el servidor."
    );
  }
}

export async function postCompleteWork(payload: {
  item: WorkItem;
  finishedQty: string;
  observation: string;
  completedBy?: string;
}): Promise<void> {
  const response = await fetch("/api/v1/live-sync/operations", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "complete_work", ...payload }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ?? "No se pudo confirmar el trabajo en el servidor."
    );
  }
}

export async function postQualityDecision(payload: {
  itemId: string;
  status: "aprobado" | "rechazado";
  decidedBy?: string;
  observation?: string;
  product?: string | null;
  client?: string | null;
  plannedDate?: string | null;
  plannedDateTo?: string | null;
  lote?: string | null;
  quantity?: string | null;
  relatedWorkItemId?: string | null;
  /** Sector de la sesión — defensa de acción en el pipeline (no auth server completo). */
  actorSectorId?: string;
}): Promise<void> {
  const response = await fetch("/api/v1/live-sync/operations", {
    method: "POST",
    credentials: "include",
    headers: jsonActorHeaders(),
    body: JSON.stringify({ action: "quality_decision", ...payload }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ?? "No se pudo registrar la decisión en el servidor."
    );
  }
}

export async function postQualityAnnul(payload: {
  itemId: string;
  reason: string;
  decidedBy?: string;
  actorSectorId?: string;
}): Promise<void> {
  const response = await fetch("/api/v1/live-sync/operations", {
    method: "POST",
    credentials: "include",
    headers: jsonActorHeaders(),
    body: JSON.stringify({ action: "quality_annul", ...payload }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ?? "No se pudo anular la decisión en el servidor."
    );
  }
}

export async function postCancelWork(payload: {
  itemId: string;
  reason: string;
  cancelledBy?: string;
  sector?: SectorId;
  actorSectorId: string;
}): Promise<Response> {
  return fetch("/api/v1/live-sync/operations", {
    method: "POST",
    credentials: "include",
    headers: jsonActorHeaders(),
    body: JSON.stringify({ action: "cancel_work", ...payload }),
  });
}

/**
 * Las 5 funciones de entregas devuelven DeliveryMutationResult (parseado,
 * no un Response crudo) — antes el caller ni siquiera chequeaba el status
 * (fire-and-forget), así que un 4xx/5xx quedaba invisible y la UI local
 * (localStorage) mostraba la mutación como si hubiese funcionado.
 */
async function postDeliveryAction(
  action: string,
  payload: object
): Promise<DeliveryMutationResult> {
  let response: globalThis.Response;
  try {
    response = await fetch("/api/v1/live-sync/operations", {
      method: "POST",
      credentials: "include",
      headers: jsonActorHeaders(),
      body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    return { ok: false, error: "Sin conexión con el servidor. Reintentá." };
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    return {
      ok: false,
      error: (data as { error?: string } | null)?.error ?? "La entrega no se pudo guardar en el servidor.",
      code: (data as { code?: string } | null)?.code,
    };
  }
  return { ok: true, record: data.record as DeliveryRecord };
}

export function postDeliverWork(
  payload: DeliveryRecord & { actorSectorId: string }
): Promise<DeliveryMutationResult> {
  return postDeliveryAction("deliver_work", payload);
}

export function postArchiveDelivery(payload: {
  id: string;
  actorSectorId: string;
}): Promise<DeliveryMutationResult> {
  return postDeliveryAction("archive_delivery", payload);
}

export function postRestoreDelivery(payload: {
  id: string;
  actorSectorId: string;
}): Promise<DeliveryMutationResult> {
  return postDeliveryAction("restore_delivery", payload);
}

export function postDeleteDeliveryRecord(payload: {
  id: string;
  reason: string;
  actorSectorId: string;
}): Promise<DeliveryMutationResult> {
  return postDeliveryAction("delete_delivery_record", payload);
}

export function postAnnulDelivery(payload: {
  id: string;
  reason: string;
  actorSectorId: string;
}): Promise<DeliveryMutationResult> {
  return postDeliveryAction("annul_delivery", payload);
}

export async function postRestoreWork(payload: {
  itemId: string;
  actorSectorId: SectorId;
  restoredBy?: string;
  reason?: string;
  sector?: SectorId;
}): Promise<Response> {
  return fetch("/api/v1/live-sync/operations", {
    method: "POST",
    credentials: "include",
    headers: jsonActorHeaders(),
    body: JSON.stringify({ action: "restore_work", ...payload }),
  });
}

/**
 * Corrección de Lote/VTO por Producción (PARTE A — fuente única). Solo
 * PRODUCCION puede llamar esto (gate server-side); Envasado/Codificado
 * quedan de solo lectura sobre estos campos.
 */
export async function postUpdateLoteVto(payload: {
  itemId: string;
  packagingLote?: string | null;
  packagingVto?: string | null;
  reason: string;
  updatedBy?: string;
  actorSectorId: SectorId;
}): Promise<Response> {
  return fetch("/api/v1/live-sync/operations", {
    method: "POST",
    credentials: "include",
    headers: jsonActorHeaders(),
    body: JSON.stringify({ action: "update_lote_vto", ...payload }),
  });
}

/**
 * Edición de campos de planificación (producto/cliente/cantidad/fecha de
 * entrega/observaciones) sobre un trabajo ya asignado. Solo PRODUCCION
 * (gate server-side); nunca toca avance/ejecución de otro sector.
 */
export async function postReworkWork(payload: {
  itemId: string;
  reason?: string | null;
  requestedBy?: string;
  actorSectorId: SectorId;
}): Promise<Response> {
  return fetch("/api/v1/live-sync/operations", {
    method: "POST",
    credentials: "include",
    headers: jsonActorHeaders(),
    body: JSON.stringify({ action: "rework_work", ...payload }),
  });
}

export async function postDeleteWork(payload: {
  itemId: string;
  reason?: string | null;
  deletedBy?: string;
  actorSectorId: SectorId;
}): Promise<Response> {
  return fetch("/api/v1/live-sync/operations", {
    method: "POST",
    credentials: "include",
    headers: jsonActorHeaders(),
    body: JSON.stringify({ action: "delete_work", ...payload }),
  });
}

export async function postEditAssignment(payload: {
  itemId: string;
  client?: string | null;
  product?: string | null;
  plannedQuantity?: string | null;
  unit?: string | null;
  deliveryDate?: string | null;
  plannedDate?: string | null;
  notes?: string | null;
  reason?: string | null;
  updatedBy?: string;
  actorSectorId: SectorId;
}): Promise<Response> {
  return fetch("/api/v1/live-sync/operations", {
    method: "POST",
    credentials: "include",
    headers: jsonActorHeaders(),
    body: JSON.stringify({ action: "edit_assignment", ...payload }),
  });
}

/** Segundos transcurridos desde una marca ISO — para indicador "Actualizado hace X s". */
export function secondsSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / 1000);
}

export function formatUpdatedAgo(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 5) return "ahora";
  if (seconds < 60) return `hace ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  return `hace ${Math.floor(minutes / 60)} h`;
}
