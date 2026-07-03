import type { QualityDecisionRecord, QualityDecisionStatus } from "../types";

const STORAGE_KEY = "genus_os_operational_decisions";

export type DecisionMap = Record<string, QualityDecisionRecord>;

export function readDecisionMap(): DecisionMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as DecisionMap;
  } catch {
    return {};
  }
}

export function writeDecisionMap(map: DecisionMap): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function recordQualityDecision(
  itemId: string,
  status: QualityDecisionStatus,
  decidedBy?: string
): QualityDecisionRecord {
  const record: QualityDecisionRecord = {
    itemId,
    status,
    decidedAt: new Date().toISOString(),
    decidedBy,
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
  const override = readDecisionMap()[itemId];
  return override?.status ?? seedStatus;
}

export function clearOperationalDecisions(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
