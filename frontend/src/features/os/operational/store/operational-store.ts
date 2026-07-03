import type { WorkItemStatus } from "@/types/operational/work-item";
import type { QualityDecisionRecord, QualityDecisionStatus } from "../types";

const DECISIONS_KEY = "genus_os_operational_decisions";
const PROGRESS_KEY = "genus_os_work_progress";

export type DecisionMap = Record<string, QualityDecisionRecord>;

export interface WorkProgressRecord {
  itemId: string;
  finishedQty: string;
  observation: string;
  status?: WorkItemStatus;
  updatedAt: string;
  updatedBy?: string;
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

function writeJsonMap<T>(key: string, map: Record<string, T>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(map));
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

export function recordQualityDecision(
  itemId: string,
  status: QualityDecisionStatus,
  options?: { decidedBy?: string; observation?: string }
): QualityDecisionRecord {
  const record: QualityDecisionRecord = {
    itemId,
    status,
    decidedAt: new Date().toISOString(),
    decidedBy: options?.decidedBy,
    observation: options?.observation?.trim() || undefined,
  };

  const map = readDecisionMap();
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
  }
): WorkProgressRecord {
  const record: WorkProgressRecord = {
    itemId,
    finishedQty: payload.finishedQty.trim(),
    observation: payload.observation.trim(),
    status: payload.status,
    updatedAt: new Date().toISOString(),
    updatedBy: payload.updatedBy,
  };

  const map = readProgressMap();
  map[itemId] = record;
  writeProgressMap(map);
  return record;
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
    if (!saved?.status) return item;
    return { ...item, status: saved.status };
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

export function clearOperationalStore(): void {
  clearOperationalDecisions();
  clearWorkProgress();
}
