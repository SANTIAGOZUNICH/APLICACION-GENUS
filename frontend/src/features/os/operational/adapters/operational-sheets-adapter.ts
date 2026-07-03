import { fetchWorkItems, OperationsApiError } from "@/lib/api/operations-client";
import type { SectorId } from "@/types/operational/sector";
import { mergeQualityItemsWithCompletions } from "../lib/completion-events";
import { readCompletionEvents } from "../store/operational-store";
import { buildMockOperationalSnapshot, mockQualityItems } from "../mock/mock-operational-plan";
import type { OperationalPlanSnapshot, QualityItem } from "../types";

export interface LoadOperationalPlanOptions {
  ownerPerson?: string | null;
}

function mergeCompletionsIntoSnapshot(
  snapshot: OperationalPlanSnapshot
): OperationalPlanSnapshot {
  const events = readCompletionEvents();
  if (events.length === 0) return snapshot;

  return {
    ...snapshot,
    qualityItems: mergeQualityItemsWithCompletions(snapshot.qualityItems, events),
  };
}

/** Carga plan operativo — API real con fallback demo; incluye terminados cross-sector. */
export async function loadOperationalPlan(
  sector: SectorId,
  options?: LoadOperationalPlanOptions
): Promise<OperationalPlanSnapshot> {
  const ownerPerson = options?.ownerPerson ?? null;

  try {
    const response = await fetchWorkItems(sector, { ownerPerson });
    if (response.workItems.length > 0) {
      return mergeCompletionsIntoSnapshot({
        sector,
        ownerPerson,
        source: response.source,
        scannedAt: response.scannedAt,
        workItems: response.workItems,
        qualityItems: mergeQualityItemsWithCompletions(mockQualityItems(), readCompletionEvents()),
        message: response.message,
      });
    }
  } catch (err) {
    if (!(err instanceof OperationsApiError)) {
      // Network or parse errors — fall through to demo data.
    }
  }

  return mergeCompletionsIntoSnapshot(buildMockOperationalSnapshot(sector, ownerPerson));
}

export function applyQualityDecisionsToItems(
  items: QualityItem[],
  getStatus: (id: string, seed: QualityItem["status"]) => QualityItem["status"]
): QualityItem[] {
  return items.map((item) => ({
    ...item,
    status: getStatus(item.id, item.status),
  }));
}
