import type { ProductionOverview } from "@/types/operational/production-overview";
import type { WorkItem, WorkItemPriority } from "@/types/operational/work-item";
import type { SectorId } from "@/types/operational/sector";
import { OPERATIONAL_SECTOR_IDS } from "@/types/operational/sector";

/** F8.1 — aggregate WorkItems for production orchestrator (no UI). */
export function buildProductionOverview(
  workItems: WorkItem[],
  source: ProductionOverview["source"] = "semanas_2026"
): ProductionOverview {
  const load: Partial<Record<SectorId, number>> = {};
  const capacity: Partial<Record<SectorId, { planned: number; unit: string | null }>> = {};
  const priorities: Partial<Record<WorkItemPriority, number>> = {};
  const blockers: ProductionOverview["blockers"] = [];
  const dependencies: ProductionOverview["dependencies"] = [];

  for (const item of workItems) {
    load[item.sector] = (load[item.sector] ?? 0) + 1;

    if (item.priority) {
      priorities[item.priority] = (priorities[item.priority] ?? 0) + 1;
    }

    if (item.status === "bloqueado") {
      blockers.push({
        workItemId: item.id,
        sector: item.sector,
        reason: item.notes,
      });
    }

    if (item.quantity) {
      const qty = Number.parseFloat(item.quantity.replace(",", "."));
      if (!Number.isNaN(qty)) {
        const current = capacity[item.sector]?.planned ?? 0;
        capacity[item.sector] = {
          planned: current + qty,
          unit: item.unit,
        };
      }
    }

    if (item.dependsOn) {
      for (const dep of item.dependsOn) {
        dependencies.push({
          fromWorkItemId: dep,
          toWorkItemId: item.id,
          relation: "dependsOn",
        });
      }
    }
    if (item.blockedBy) {
      for (const blocker of item.blockedBy) {
        dependencies.push({
          fromWorkItemId: blocker,
          toWorkItemId: item.id,
          relation: "blockedBy",
        });
      }
    }
    if (item.unblocks) {
      for (const target of item.unblocks) {
        dependencies.push({
          fromWorkItemId: item.id,
          toWorkItemId: target,
          relation: "unblocks",
        });
      }
    }
  }

  const activeSectors = OPERATIONAL_SECTOR_IDS.filter((s) => (load[s] ?? 0) > 0);

  return {
    scannedAt: new Date().toISOString(),
    source,
    capacity: Object.keys(capacity).length > 0 ? capacity : null,
    load: Object.keys(load).length > 0 ? load : null,
    blockers,
    sectors: activeSectors,
    priorities: Object.keys(priorities).length > 0 ? priorities : null,
    dependencies,
    warnings: [],
  };
}
