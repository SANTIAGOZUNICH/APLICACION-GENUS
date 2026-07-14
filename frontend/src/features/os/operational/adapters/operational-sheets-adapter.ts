import { fetchWorkItems, OperationsApiError } from "@/lib/api/operations-client";
import type { SectorId } from "@/types/operational/sector";
import { mergeQualityItemsWithCompletions } from "../lib/completion-events";
import { readCompletionEvents } from "../store/operational-store";
import { mockQualityItems } from "../mock/mock-operational-plan";
import type { OperationalPlanSnapshot, QualityItem } from "../types";

export interface LoadOperationalPlanOptions {
  ownerPerson?: string | null;
  date?: string | null;
  weekStart?: string | null;
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

function qualitySeedForSource(source: OperationalPlanSnapshot["source"]): QualityItem[] {
  return source === "drive" ? [] : mockQualityItems();
}

/** Carga plan operativo — respeta API real; no inventa mock si el servidor respondió. */
export async function loadOperationalPlan(
  sector: SectorId,
  options?: LoadOperationalPlanOptions
): Promise<OperationalPlanSnapshot> {
  const ownerPerson = options?.ownerPerson ?? null;
  const date = options?.date ?? null;
  const weekStart = options?.weekStart ?? null;

  try {
    const response = await fetchWorkItems(sector, { ownerPerson, date, weekStart });

    return mergeCompletionsIntoSnapshot({
      sector,
      ownerPerson,
      source: response.source,
      scannedAt: response.scannedAt,
      workItems: response.workItems,
      qualityItems: mergeQualityItemsWithCompletions(
        response.qualityItems?.length
          ? response.qualityItems
          : qualitySeedForSource(response.source),
        readCompletionEvents()
      ),
      operationalOverlay: response.operationalOverlay,
      revision: response.revision,
      semanasVersion: response.semanasVersion,
      message:
        response.message ??
        (response.source === "demo"
          ? "Servidor en modo demo — configurá GENUS_DATA_MODE=real y credenciales Google en Vercel."
          : response.workItems.length === 0
            ? "Sin trabajos en SEMANAS 2026 para este sector."
            : undefined),
    });
  } catch (err) {
    const message =
      err instanceof OperationsApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Error al cargar plan operativo.";

    return mergeCompletionsIntoSnapshot({
      sector,
      ownerPerson,
      source: "demo",
      scannedAt: new Date().toISOString(),
      workItems: [],
      qualityItems: mergeQualityItemsWithCompletions([], readCompletionEvents()),
      message,
    });
  }
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
