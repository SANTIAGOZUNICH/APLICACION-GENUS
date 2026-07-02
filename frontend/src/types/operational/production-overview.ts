import type { SectorId } from "@/types/operational/sector";
import type { WorkItemPriority } from "@/types/operational/work-item";

/** F8.1 — Production orchestrator model (no UI yet). */
export interface ProductionOverview {
  scannedAt: string;
  source: "semanas_2026" | "demo";
  capacity: Partial<Record<SectorId, { planned: number; unit: string | null }>> | null;
  load: Partial<Record<SectorId, number>> | null;
  blockers: Array<{
    workItemId: string;
    sector: SectorId;
    reason: string | null;
  }>;
  sectors: SectorId[];
  priorities: Partial<Record<WorkItemPriority, number>> | null;
  dependencies: Array<{
    fromWorkItemId: string;
    toWorkItemId: string;
    relation: "dependsOn" | "blockedBy" | "unblocks";
  }>;
  warnings: string[];
}
