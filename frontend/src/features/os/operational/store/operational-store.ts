import type { WorkItem, WorkItemStatus } from "@/types/operational/work-item";
import { workItemToCompletionEvent } from "../lib/completion-events";
import type { CompletionEvent, QualityDecisionRecord, QualityDecisionStatus } from "../types";

const DECISIONS_KEY = "genus_os_operational_decisions";
const PROGRESS_KEY = "genus_os_work_progress";
const COMPLETIONS_KEY = "genus_os_completion_events";

export type DecisionMap = Record<string, QualityDecisionRecord>;

export type PackingGroupRecord = { cajas: number; unidadesPorCaja: number };

export interface WorkProgressRecord {
  itemId: string;
  finishedQty: string;
  observation: string;
  status?: WorkItemStatus;
  updatedAt: string;
  updatedBy?: string;
  completedAt?: string;
  packagingLote?: string | null;
  packagingVto?: string | null;
  packagingTotalUnits?: number | null;
  packagingCajas?: number | null;
  packagingUnidadesPorCaja?: number | null;
  packingGroups?: PackingGroupRecord[] | null;
  packingMismatchObservation?: string | null;
  /** Flujo Codificado */
  sentToCodificadoAt?: string | null;
  sentToCodificadoBy?: string | null;
  codificadoOriginSector?: string | null;
  codificadoObservation?: string | null;
  viaCodificado?: boolean;
  deliveredFromCodificadoAt?: string | null;
  deliveredFromCodificadoBy?: string | null;
  bulkRemainderKg?: number | null;
  bulkRemainderObservation?: string | null;
  bulkRemainderId?: string | null;
}

export type ProgressMap = Record<string, WorkProgressRecord>;

function readJsonMap<T>(key: string): Record<string, T> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, T>;
  } catch {
    return {};
  }
}

function readJsonArray<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

function writeJsonMap<T>(key: string, map: Record<string, T>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(map));
}

function writeJsonArray<T>(key: string, items: T[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(items));
}

export function readDecisionMap(): DecisionMap {
  return readJsonMap<QualityDecisionRecord>(DECISIONS_KEY);
}

export function writeDecisionMap(map: DecisionMap): void {
  writeJsonMap(DECISIONS_KEY, map);
}

export function readProgressMap(): ProgressMap {
  return readJsonMap<WorkProgressRecord>(PROGRESS_KEY);
}

export function writeProgressMap(map: ProgressMap): void {
  writeJsonMap(PROGRESS_KEY, map);
}

export function readCompletionEvents(): CompletionEvent[] {
  return readJsonArray<CompletionEvent>(COMPLETIONS_KEY);
}

export function writeCompletionEvents(events: CompletionEvent[]): void {
  writeJsonArray(COMPLETIONS_KEY, events);
}

export function recordQualityDecision(
  itemId: string,
  status: QualityDecisionStatus,
  options?: {
    decidedBy?: string;
    decidedBySector?: string;
    decidedByEmail?: string;
    observation?: string;
    changeReason?: string;
  }
): QualityDecisionRecord {
  const map = readDecisionMap();
  const previous = map[itemId];
  const record: QualityDecisionRecord = {
    itemId,
    status,
    decidedAt: new Date().toISOString(),
    decidedBy: options?.decidedBy,
    decidedBySector: options?.decidedBySector,
    decidedByEmail: options?.decidedByEmail,
    observation: options?.observation?.trim() || undefined,
    previousStatus: previous?.status,
    changeReason: options?.changeReason?.trim() || undefined,
  };

  map[itemId] = record;
  writeDecisionMap(map);
  return record;
}

export function getEffectiveQualityStatus(
  itemId: string,
  seedStatus: QualityDecisionStatus
): QualityDecisionStatus {
  return readDecisionMap()[itemId]?.status ?? seedStatus;
}

export function getQualityObservation(itemId: string): string {
  return readDecisionMap()[itemId]?.observation ?? "";
}

export function recordWorkProgress(
  itemId: string,
  payload: {
    finishedQty: string;
    observation: string;
    status?: WorkItemStatus;
    updatedBy?: string;
    packagingLote?: string | null;
    packagingVto?: string | null;
    packagingTotalUnits?: number | null;
    packagingCajas?: number | null;
    packagingUnidadesPorCaja?: number | null;
    packingGroups?: PackingGroupRecord[] | null;
    packingMismatchObservation?: string | null;
  }
): WorkProgressRecord {
  const existing = readProgressMap()[itemId];
  const record: WorkProgressRecord = {
    itemId,
    finishedQty: payload.finishedQty.trim(),
    observation: payload.observation.trim(),
    status: payload.status ?? existing?.status,
    updatedAt: new Date().toISOString(),
    updatedBy: payload.updatedBy,
    completedAt:
      payload.status === "completo" ||
      payload.status === "revision" ||
      payload.status === "entregado" ||
      payload.status === "codificado_completo"
        ? existing?.completedAt ?? new Date().toISOString()
        : existing?.completedAt,
    packagingLote:
      payload.packagingLote !== undefined
        ? payload.packagingLote
        : existing?.packagingLote ?? null,
    packagingVto:
      payload.packagingVto !== undefined
        ? payload.packagingVto
        : existing?.packagingVto ?? null,
    packagingTotalUnits:
      payload.packagingTotalUnits !== undefined
        ? payload.packagingTotalUnits
        : existing?.packagingTotalUnits ?? null,
    packagingCajas:
      payload.packagingCajas !== undefined
        ? payload.packagingCajas
        : existing?.packagingCajas ?? null,
    packagingUnidadesPorCaja:
      payload.packagingUnidadesPorCaja !== undefined
        ? payload.packagingUnidadesPorCaja
        : existing?.packagingUnidadesPorCaja ?? null,
    packingGroups:
      payload.packingGroups !== undefined
        ? payload.packingGroups
        : existing?.packingGroups ?? null,
    packingMismatchObservation:
      payload.packingMismatchObservation !== undefined
        ? payload.packingMismatchObservation
        : existing?.packingMismatchObservation ?? null,
  };

  const map = readProgressMap();
  map[itemId] = record;
  writeProgressMap(map);
  return record;
}

/** Guarda embalaje sin exigir cambio de finishedQty (preserva avance previo). */
export function recordWorkPackaging(
  itemId: string,
  payload: {
    updatedBy?: string;
    packagingLote?: string | null;
    packagingVto?: string | null;
    packagingTotalUnits?: number | null;
    packagingCajas?: number | null;
    packagingUnidadesPorCaja?: number | null;
    packingGroups?: PackingGroupRecord[] | null;
    packingMismatchObservation?: string | null;
  }
): WorkProgressRecord {
  const existing = readProgressMap()[itemId];
  return recordWorkProgress(itemId, {
    finishedQty: existing?.finishedQty ?? "",
    observation: existing?.observation ?? "",
    status: existing?.status,
    updatedBy: payload.updatedBy,
    packagingLote: payload.packagingLote,
    packagingVto: payload.packagingVto,
    packagingTotalUnits: payload.packagingTotalUnits,
    packagingCajas: payload.packagingCajas,
    packagingUnidadesPorCaja: payload.packagingUnidadesPorCaja,
    packingGroups: payload.packingGroups,
    packingMismatchObservation: payload.packingMismatchObservation,
  });
}

/** Marca terminado y transfiere responsabilidad a Calidad. */
export function recordWorkCompletion(
  item: WorkItem,
  payload: { finishedQty: string; observation: string; completedBy: string }
): { progress: WorkProgressRecord; event: CompletionEvent } {
  const completedAt = new Date().toISOString();
  const progress = recordWorkProgress(item.id, {
    ...payload,
    status: "revision",
    updatedBy: payload.completedBy,
  });
  progress.completedAt = completedAt;
  const map = readProgressMap();
  map[item.id] = progress;
  writeProgressMap(map);

  const event = workItemToCompletionEvent(item, {
    ...payload,
    completedAt,
  });

  const events = readCompletionEvents().filter((e) => e.workItemId !== item.id);
  events.push(event);
  writeCompletionEvents(events);

  return { progress, event };
}

export function getWorkProgress(itemId: string): WorkProgressRecord | null {
  return readProgressMap()[itemId] ?? null;
}

export function getEffectiveWorkStatus(
  itemId: string,
  seedStatus: WorkItemStatus
): WorkItemStatus {
  return readProgressMap()[itemId]?.status ?? seedStatus;
}

export function getWorkFinishedQty(itemId: string): string {
  return readProgressMap()[itemId]?.finishedQty ?? "";
}

export function getWorkObservation(itemId: string): string {
  return readProgressMap()[itemId]?.observation ?? "";
}

export function applyWorkProgressToItems<T extends { id: string; status: WorkItemStatus }>(
  items: T[]
): T[] {
  const progress = readProgressMap();
  return items.map((item) => {
    const saved = progress[item.id];
    if (!saved) return item;
    const prev = item as T & {
      finishedQty?: string;
      packagingLote?: string | null;
      packagingVto?: string | null;
      packagingTotalUnits?: number | null;
      packagingCajas?: number | null;
      packagingUnidadesPorCaja?: number | null;
      packingGroups?: PackingGroupRecord[] | null;
      packingMismatchObservation?: string | null;
    };
    const next = {
      ...item,
      ...(saved.status ? { status: saved.status } : {}),
      ...(saved.finishedQty ? { finishedQty: saved.finishedQty } : {}),
      packagingLote: saved.packagingLote ?? prev.packagingLote ?? null,
      packagingVto: saved.packagingVto ?? prev.packagingVto ?? null,
      packagingTotalUnits:
        saved.packagingTotalUnits ?? prev.packagingTotalUnits ?? null,
      packagingCajas: saved.packagingCajas ?? prev.packagingCajas ?? null,
      packagingUnidadesPorCaja:
        saved.packagingUnidadesPorCaja ?? prev.packagingUnidadesPorCaja ?? null,
      packingGroups: saved.packingGroups ?? prev.packingGroups ?? null,
      packingMismatchObservation:
        saved.packingMismatchObservation ??
        prev.packingMismatchObservation ??
        null,
    };
    return next as T;
  });
}

/** Envasado → Codificado (sin CompletionEvent / sin Calidad). Idempotente. */
export function recordSendToCodificado(
  item: WorkItem,
  payload: {
    totalUnits: number;
    observation?: string;
    sentBy: string;
    bulkRemainderKg?: number | null;
    bulkRemainderObservation?: string | null;
    bulkRemainderId?: string | null;
  }
): { progress: WorkProgressRecord; already: boolean } {
  const map = readProgressMap();
  const existing = map[item.id];
  if (existing?.status === "en_codificado" || existing?.sentToCodificadoAt) {
    return { progress: existing!, already: true };
  }
  const now = new Date().toISOString();
  const finishedQty =
    existing?.finishedQty?.trim() ||
    String(payload.totalUnits) ||
    item.quantity ||
    "";
  const progress: WorkProgressRecord = {
    ...(existing ?? {
      itemId: item.id,
      finishedQty,
      observation: "",
      updatedAt: now,
    }),
    itemId: item.id,
    finishedQty,
    observation: payload.observation?.trim() || existing?.observation || "",
    status: "en_codificado",
    updatedAt: now,
    updatedBy: payload.sentBy,
    packagingLote: existing?.packagingLote ?? item.packagingLote ?? null,
    packagingVto: existing?.packagingVto ?? item.packagingVto ?? null,
    packagingTotalUnits: payload.totalUnits,
    packagingCajas: existing?.packagingCajas ?? item.packagingCajas ?? null,
    packagingUnidadesPorCaja:
      existing?.packagingUnidadesPorCaja ?? item.packagingUnidadesPorCaja ?? null,
    packingGroups: existing?.packingGroups ?? item.packingGroups ?? null,
    packingMismatchObservation:
      existing?.packingMismatchObservation ?? item.packingMismatchObservation ?? null,
    sentToCodificadoAt: now,
    sentToCodificadoBy: payload.sentBy,
    codificadoOriginSector: item.sector,
    viaCodificado: true,
    bulkRemainderKg: payload.bulkRemainderKg ?? existing?.bulkRemainderKg ?? null,
    bulkRemainderObservation:
      payload.bulkRemainderObservation ?? existing?.bulkRemainderObservation ?? null,
    bulkRemainderId: payload.bulkRemainderId ?? existing?.bulkRemainderId ?? null,
  };
  map[item.id] = progress;
  writeProgressMap(map);
  return { progress, already: false };
}

/** Codificado → Calidad + Producción (una sola CompletionEvent). Idempotente. */
export function recordDeliverFromCodificado(
  item: WorkItem,
  payload: {
    completedBy: string;
    observation?: string;
    packagingLote?: string | null;
    packagingVto?: string | null;
  }
): { progress: WorkProgressRecord; event: CompletionEvent; already: boolean } {
  const map = readProgressMap();
  const existing = map[item.id];
  if (
    existing?.status === "revision" ||
    existing?.status === "codificado_completo" ||
    existing?.deliveredFromCodificadoAt
  ) {
    const events = readCompletionEvents();
    const event =
      events.find((e) => e.workItemId === item.id) ??
      workItemToCompletionEvent(item, {
        finishedQty: existing?.finishedQty || String(existing?.packagingTotalUnits ?? ""),
        observation: existing?.observation || "",
        completedBy: existing?.deliveredFromCodificadoBy || payload.completedBy,
        completedAt: existing?.deliveredFromCodificadoAt || undefined,
      });
    return { progress: existing!, event, already: true };
  }

  const originSector = (existing?.codificadoOriginSector || item.sector) as WorkItem["sector"];
  const enriched: WorkItem = {
    ...item,
    sector: originSector,
    packagingLote:
      payload.packagingLote !== undefined
        ? payload.packagingLote
        : existing?.packagingLote ?? item.packagingLote ?? null,
    packagingVto:
      payload.packagingVto !== undefined
        ? payload.packagingVto
        : existing?.packagingVto ?? item.packagingVto ?? null,
    packagingTotalUnits: existing?.packagingTotalUnits ?? item.packagingTotalUnits ?? null,
    packingGroups: existing?.packingGroups ?? item.packingGroups ?? null,
    loteRef:
      (payload.packagingLote !== undefined
        ? payload.packagingLote
        : existing?.packagingLote) || item.loteRef,
  };

  const finishedQty =
    existing?.finishedQty ||
    (enriched.packagingTotalUnits != null ? String(enriched.packagingTotalUnits) : "") ||
    item.quantity ||
    "";
  const observation =
    [existing?.observation, payload.observation, existing?.codificadoObservation]
      .filter(Boolean)
      .join(" · ") || "";

  const { progress, event } = recordWorkCompletion(enriched, {
    finishedQty,
    observation,
    completedBy: payload.completedBy,
  });

  const now = new Date().toISOString();
  const next: WorkProgressRecord = {
    ...progress,
    packagingLote: enriched.packagingLote,
    packagingVto: enriched.packagingVto,
    packagingTotalUnits: enriched.packagingTotalUnits,
    packingGroups: enriched.packingGroups,
    viaCodificado: true,
    codificadoOriginSector: originSector,
    sentToCodificadoAt: existing?.sentToCodificadoAt ?? null,
    sentToCodificadoBy: existing?.sentToCodificadoBy ?? null,
    deliveredFromCodificadoAt: now,
    deliveredFromCodificadoBy: payload.completedBy,
    codificadoObservation: payload.observation?.trim() || existing?.codificadoObservation || null,
    status: "revision",
  };
  const map2 = readProgressMap();
  map2[item.id] = next;
  writeProgressMap(map2);
  return { progress: next, event, already: false };
}

export function clearOperationalDecisions(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(DECISIONS_KEY);
}

export function clearWorkProgress(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PROGRESS_KEY);
}

export function clearCompletionEvents(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(COMPLETIONS_KEY);
}

export function clearOperationalStore(): void {
  clearOperationalDecisions();
  clearWorkProgress();
  clearCompletionEvents();
}
