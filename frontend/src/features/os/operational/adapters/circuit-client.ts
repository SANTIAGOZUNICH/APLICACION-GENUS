import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import type { WorkItem } from "@/types/operational/work-item";
import type { SectorId } from "@/types/operational/sector";
import type { PendingDefinitionInfo } from "@/lib/planning/circuit/pending-definition";
import type { EnvasadoDestination } from "@/lib/planning/circuit/destination";

/** Cliente HTTP del circuito operativo sin Calidad (Elaboración→Envasado, entregas parciales, pendientes). */

type Session = { email?: string | null; sector?: string | null };

function headers(session: Session): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (session.email) h[ACTOR_EMAIL_HEADER] = session.email;
  if (session.sector) h[ACTOR_SECTOR_HEADER] = session.sector;
  return h;
}

function plainId(workItemId: string): string {
  return workItemId.startsWith("native:") ? workItemId.slice("native:".length) : workItemId;
}

export function newIdempotencyKey(prefix: string): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function parse<T>(res: Response, fallback: string): Promise<T> {
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !json) {
    throw new Error((json as { error?: string } | null)?.error || `${fallback} (${res.status}).`);
  }
  return json;
}

export interface EnvasadoSuggestion {
  sector: EnvasadoDestination | null;
  reason: string;
  pedidoOp: string | null;
  unitsHint: string | null;
}

export async function fetchEnvasadoSuggestion(session: Session, workItemId: string): Promise<EnvasadoSuggestion> {
  const res = await fetch(`/api/v1/work-items/${encodeURIComponent(plainId(workItemId))}/envasado`, {
    credentials: "include",
    headers: headers(session),
    cache: "no-store",
  });
  return parse<EnvasadoSuggestion>(res, "No se pudo deducir el Envasado de destino");
}

export interface SendToEnvasadoPayload {
  destination?: EnvasadoDestination | null;
  line?: string | null;
  producedQuantity?: string | null;
  unitsToPackage?: string | null;
  observation?: string | null;
  plannedDate?: string | null;
  idempotencyKey: string;
}

export interface SendToEnvasadoResult {
  ok: true;
  replayed: boolean;
  linked: boolean;
  destinationSector: EnvasadoDestination;
  workItem: WorkItem;
  destinationWorkItem: WorkItem;
}

export async function postSendToEnvasado(
  session: Session,
  workItemId: string,
  body: SendToEnvasadoPayload
): Promise<SendToEnvasadoResult> {
  const res = await fetch(`/api/v1/work-items/${encodeURIComponent(plainId(workItemId))}/envasado`, {
    method: "POST",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify(body),
  });
  return parse<SendToEnvasadoResult>(res, "No se pudo enviar a Envasado");
}

export interface CircuitDeliveryPayload {
  workItemId: string;
  actorSectorId: SectorId | string;
  /** Unidades entregadas ahora. Omitido = todo el saldo (en parcial es obligatoria). */
  deliverQuantity?: number | null;
  /** «Entregar parcial»: el servidor mide el saldo contra lo asignado y no cierra el trabajo hasta completarlo. */
  partial?: boolean;
  idempotencyKey: string;
  actualDeliveredAt: string;
  remito?: string | null;
  receivedBy?: string | null;
  observations?: string | null;
  /** Cajas de esta entrega: [{cajas, unidadesPorCaja}] (deben sumar lo entregado). */
  deliveryPackingGroups?: Array<{ cajas: number; unidadesPorCaja: number }> | null;
  plannedDeliveryDate?: string | null;
  codigo?: string | null;
  sourceSector: SectorId | string;
  /** Cierre aplicado en la misma transacción que la entrega. */
  completion?: {
    finishedQty?: string | null;
    observation?: string | null;
    packagingLote?: string | null;
    packagingVto?: string | null;
    packagingTotalUnits?: number | null;
    packingGroups?: Array<{ cajas: number; unidadesPorCaja: number }> | null;
    sampleUnits?: number | null;
    packingMismatchObservation?: string | null;
    bulkRemainderKg?: number | null;
    bulkRemainderObservation?: string | null;
    bulkRemainderId?: string | null;
  } | null;
}

export interface CircuitDeliveryResult {
  ok: true;
  replayed: boolean;
  complete: boolean;
  delivered: number | null;
  pending: number | null;
  /** Otras apariciones del mismo trabajo (otros días) que se entregaron junto con esta. */
  synced?: string[];
}

/** Registra una entrega final (total o parcial) vía deliver_work. Misma clave = misma entrega. */
export async function postCircuitDelivery(
  session: Session,
  payload: CircuitDeliveryPayload
): Promise<CircuitDeliveryResult> {
  const res = await fetch("/api/v1/live-sync/operations", {
    method: "POST",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify({
      action: "deliver_work",
      ...payload,
      // Campos del registro histórico que el servidor relee de Neon y descarta.
      product: "",
      codigo: payload.codigo ?? null,
      plannedDeliveryDate: payload.plannedDeliveryDate ?? null,
      remito: payload.remito ?? null,
      receivedBy: payload.receivedBy ?? null,
      observations: payload.observations ?? null,
    }),
  });
  return parse<CircuitDeliveryResult>(res, "No se pudo registrar la entrega");
}

export interface DeliveryProgress {
  /** Acumulado entregado (unidades). */
  delivered: number;
  pending: number | null;
  complete: boolean;
}

/** Entrega vigente de un trabajo (si hay) — para mostrar saldo y entregas parciales previas. */
export async function fetchDeliveryProgress(session: Session, workItemId: string): Promise<DeliveryProgress | null> {
  const res = await fetch("/api/v1/deliveries", { credentials: "include", headers: headers(session), cache: "no-store" });
  const json = (await res.json().catch(() => null)) as {
    deliveries?: Array<{
      workItemId: string;
      status: string;
      archived?: boolean;
      quantity: string | null;
      deliveryComplete?: boolean;
      pendingBalance?: number | null;
    }>;
  } | null;
  if (!res.ok || !json) return null;
  const row = (json.deliveries ?? []).find(
    (d) => d.workItemId === workItemId && d.status === "ENTREGADO" && !d.archived
  );
  if (!row) return null;
  const delivered = Number(String(row.quantity ?? "0").replace(",", "."));
  return {
    delivered: Number.isFinite(delivered) ? delivered : 0,
    pending: row.pendingBalance ?? null,
    complete: row.deliveryComplete ?? true,
  };
}

export interface PendingDefinitionItem {
  workItem: WorkItem;
  info: PendingDefinitionInfo;
}

export async function fetchPendingDefinition(session: Session): Promise<{
  items: PendingDefinitionItem[];
  legacyQualityPending: number;
}> {
  const res = await fetch("/api/v1/work-items/pending-definition", {
    credentials: "include",
    headers: headers(session),
    cache: "no-store",
  });
  const json = await parse<{ items: PendingDefinitionItem[]; legacyQualityPending: number }>(
    res,
    "No se pudieron cargar los pendientes de definir"
  );
  return { items: json.items ?? [], legacyQualityPending: json.legacyQualityPending ?? 0 };
}

/** Eliminación masiva de trabajos (Producción). `dryRun` = solo veredictos, no escribe. */
export async function postBulkDeleteWorks(
  session: Session,
  payload: {
    ids: string[];
    reason: string;
    dryRun?: boolean;
    batchKey?: string;
    expectedVersions?: Record<string, number>;
  }
): Promise<import("../lib/bulk-delete-verdicts").BulkDeleteResult> {
  const res = await fetch("/api/v1/work-items/bulk-delete", {
    method: "POST",
    credentials: "include",
    headers: { ...headers(session), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parse<import("../lib/bulk-delete-verdicts").BulkDeleteResult>(res, "No se pudo eliminar la selección");
}

/** Acciones masivas de Pendientes de definir (entregar / enviar a Codificado). `dryRun` = previa sin escribir. */
export async function postBulkPendingAction(
  session: Session,
  payload: {
    action: import("../lib/bulk-action-verdicts").BulkPendingAction;
    items: Array<{ id: string; totalUnits?: number | null }>;
    dryRun?: boolean;
    batchKey?: string;
    delivery?: { actualDeliveredAt?: string | null; remito?: string | null; receivedBy?: string | null; observations?: string | null };
    observation?: string | null;
  }
): Promise<import("../lib/bulk-action-verdicts").BulkActionResult> {
  const res = await fetch("/api/v1/work-items/bulk-action", {
    method: "POST",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify(payload),
  });
  return parse(res, "No se pudo procesar la selección");
}
