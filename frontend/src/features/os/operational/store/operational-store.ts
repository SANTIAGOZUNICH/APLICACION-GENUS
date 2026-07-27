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
      payload.status === "entregado"
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
    const next = {
      ...item,
      ...(saved.status ? { status: saved.status } : {}),
      ...(saved.finishedQty
        ? { finishedQty: saved.finishedQty }
        : {}),
      packagingLote: saved.packagingLote ?? (item as WorkItem).packagingLote ?? null,
      packagingVto: saved.packagingVto ?? (item as WorkItem).packagingVto ?? null,
      packagingTotalUnits:
        saved.packagingTotalUnits ?? (item as WorkItem).packagingTotalUnits ?? null,
      packagingCajas: saved.packagingCajas ?? (item as WorkItem).packagingCajas ?? null,
      packagingUnidadesPorCaja:
        saved.packagingUnidadesPorCaja ??
        (item as WorkItem).packagingUnidadesPorCaja ??
        null,
      packingGroups: saved.packingGroups ?? (item as WorkItem).packingGroups ?? null,
      packingMismatchObservation:
        saved.packingMismatchObservation ??
        (item as WorkItem).packingMismatchObservation ??
        null,
    };
    return next as T;
  });
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
