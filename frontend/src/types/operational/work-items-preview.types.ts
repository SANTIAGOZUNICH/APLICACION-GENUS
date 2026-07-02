import type { ProductionOverview } from "@/types/operational/production-overview";
import type { SectorId } from "@/types/operational/sector";
import type { WorkItem } from "@/types/operational/work-item";

export interface WorkItemsPreviewResponse {
  sector: SectorId;
  scannedAt: string;
  source: "drive" | "demo";
  profile: {
    greeting: string;
    mission: string;
    allowedActions: string[];
    deniedActions: string[];
    expectedSources: Array<{
      key: string;
      label: string;
      mapperStatus: "f8_1" | "f8_2_pending";
      indexed: boolean;
      workItemCount: number;
    }>;
  };
  workItems: WorkItem[];
  counts: {
    total: number;
    hoy: number;
    semana: number;
    pendientes: number;
    bloqueados: number;
  };
  sections: {
    hoy: WorkItem[];
    semana: WorkItem[];
    pendientes: WorkItem[];
    bloqueados: WorkItem[];
  };
  sourceBreakdown: {
    semanas_2026: number;
    pedidos_2026: number;
    asignacion_lotes_2026: number;
  };
  dependencies: {
    withDependsOn: number;
    withBlockedBy: number;
    withUnblocks: number;
    chainNote: string;
    items: Array<{
      workItemId: string;
      product: string | null;
      sector: SectorId;
      dependsOn: string[] | null;
      blockedBy: string[] | null;
      unblocks: string[] | null;
    }>;
  };
  gaps: Array<{
    field: string;
    missingCount: number;
    totalCount: number;
  }>;
  mapperWarnings: string[];
  message?: string;
  productionOverview?: ProductionOverview;
  globalStats: {
    totalAllSectors: number;
    bySector: Partial<Record<SectorId, number>>;
    byOriginStage: Partial<Record<WorkItem["originStage"], number>>;
  };
}

export interface WorkItemsDebugResponse {
  scannedAt: string;
  source: "drive" | "demo";
  totalCount: number;
  bySector: Partial<Record<SectorId, number>>;
  bySource: Partial<Record<WorkItem["source"], number>>;
  byOriginStage: Partial<Record<WorkItem["originStage"], number>>;
  byPriority: Record<string, number>;
  byConfidence: Partial<Record<WorkItem["confidence"], number>>;
  dependencies: {
    withDependsOn: number;
    withBlockedBy: number;
    withUnblocks: number;
  };
  workItems: WorkItem[];
  mapperWarnings: string[];
  productionOverview: ProductionOverview;
  sourcesIndexed: {
    semanas_2026: boolean;
    pedidos_2026: boolean;
    asignacion_lotes_2026: boolean;
  };
  sourcesMapped: {
    semanas_2026: number;
    pedidos_2026: number;
    asignacion_lotes_2026: number;
  };
  gaps: Array<{
    field: string;
    missingCount: number;
    totalCount: number;
  }>;
  message?: string;
}
