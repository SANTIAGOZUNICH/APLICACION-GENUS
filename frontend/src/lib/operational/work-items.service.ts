import "server-only";

import { liveSyncEngine } from "@/lib/live-sync/live-sync-engine";
import {
  countMiTrabajoSections,
  filterWorkItemsForSector,
  filterWorkItemsForSectorAndPerson,
  partitionMiTrabajoSections,
} from "@/lib/operational/work-item-filters";
import {
  analyzeWorkItemGaps,
  countWorkItemsByOriginStage,
  countWorkItemsBySector,
  countWorkItemsBySource,
  countWorkItemsByConfidence,
  countWorkItemsByPriority,
  summarizeDependencies,
} from "@/lib/operational/analyze-work-items";
import { getProductionOverviewFromSnapshot } from "@/lib/live-sync/live-sync-engine";
import { liveSyncStore } from "@/lib/live-sync/live-sync-store";
import { SECTOR_PREVIEW_PROFILES } from "@/config/sector-preview";
import { SECTOR_GREETING, type SectorId } from "@/types/operational/sector";
import type { WorkItem } from "@/types/operational/work-item";
import type { WorkItemsResponse } from "@/types/operational/work-item";
import type {
  WorkItemsDebugResponse,
  WorkItemsPreviewResponse,
} from "@/types/operational/work-items-preview.types";
import type { QualityItem } from "@/features/os/operational/types";

/** WorkItems vía Live Sync Engine — snapshot caliente, sync incremental en background. */
export class WorkItemsService {
  async listForSector(
    sector: SectorId,
    ownerPersonOrOptions?: string | null | {
      ownerPerson?: string | null;
      date?: string | null;
      weekStart?: string | null;
    }
  ): Promise<WorkItemsResponse> {
    return liveSyncEngine.listForSector(sector, ownerPersonOrOptions);
  }

  async getPreviewForSector(sector: SectorId): Promise<WorkItemsPreviewResponse> {
    const snapshot = await liveSyncEngine.getSnapshot();
    const workItems = snapshot?.workItems ?? [];
    const warnings = snapshot?.warnings ?? [];
    const sourcesIndexed = snapshot?.sourcesIndexed ?? {
      semanas_2026: false,
      pedidos_2026: false,
      asignacion_lotes_2026: false,
    };

    const profileConfig = SECTOR_PREVIEW_PROFILES[sector];
    const filtered = filterWorkItemsForSector(workItems, sector);
    const sections = partitionMiTrabajoSections(filtered);
    const bySource = countWorkItemsBySource(workItems);
    const bySector = countWorkItemsBySector(workItems);

    const sourceBreakdown = {
      semanas_2026: bySource.semanas_2026 ?? 0,
      pedidos_2026: bySource.pedidos_2026 ?? 0,
      asignacion_lotes_2026: bySource.asignacion_lotes_2026 ?? 0,
    };

    const expectedSources =
      profileConfig?.expectedSources.map((src) => ({
        ...src,
        indexed: sourcesIndexed[src.key],
        workItemCount: sourceBreakdown[src.key] ?? 0,
      })) ?? [];

    const productionOverview =
      sector === "PRODUCCION" ? getProductionOverviewFromSnapshot() ?? undefined : undefined;

    if (productionOverview) {
      productionOverview.warnings = warnings.slice(0, 10);
    }

    return {
      sector,
      scannedAt: snapshot?.sheetsSyncedAt ?? new Date().toISOString(),
      source: "drive",
      profile: {
        greeting: SECTOR_GREETING[sector as keyof typeof SECTOR_GREETING] ?? sector,
        mission: profileConfig?.mission ?? "Sector operativo Genus OS.",
        allowedActions: profileConfig?.allowedActions ?? [],
        deniedActions: profileConfig?.deniedActions ?? [],
        expectedSources,
      },
      workItems: filtered,
      counts: countMiTrabajoSections(filtered),
      sections,
      sourceBreakdown,
      dependencies: summarizeDependencies(filtered),
      gaps: analyzeWorkItemGaps(filtered),
      mapperWarnings: warnings.slice(0, 20),
      message:
        filtered.length > 0
          ? `${filtered.length} WorkItem(s) visibles para ${sector}.`
          : `No hay trabajos asignados para ${sector}.`,
      productionOverview,
      globalStats: {
        totalAllSectors: workItems.length,
        bySector,
        byOriginStage: countWorkItemsByOriginStage(workItems),
      },
    };
  }

  async getDebugSnapshot(): Promise<WorkItemsDebugResponse> {
    const snapshot = await liveSyncEngine.warmSnapshot();
    const workItems = snapshot?.workItems ?? [];
    const warnings = snapshot?.warnings ?? [];
    const sourcesIndexed = snapshot?.sourcesIndexed ?? {
      semanas_2026: false,
      pedidos_2026: false,
      asignacion_lotes_2026: false,
    };
    const bySource = countWorkItemsBySource(workItems);
    const overview = getProductionOverviewFromSnapshot();
    if (overview) overview.warnings = warnings.slice(0, 20);

    const deps = summarizeDependencies(workItems);

    return {
      scannedAt: snapshot?.updatedAt ?? new Date().toISOString(),
      source: "drive",
      totalCount: workItems.length,
      bySector: countWorkItemsBySector(workItems),
      bySource,
      byOriginStage: countWorkItemsByOriginStage(workItems),
      byPriority: countWorkItemsByPriority(workItems),
      byConfidence: countWorkItemsByConfidence(workItems),
      dependencies: {
        withDependsOn: deps.withDependsOn,
        withBlockedBy: deps.withBlockedBy,
        withUnblocks: deps.withUnblocks,
      },
      workItems,
      mapperWarnings: warnings,
      productionOverview: overview ?? {
        scannedAt: new Date().toISOString(),
        source: "semanas_2026",
        capacity: null,
        load: null,
        blockers: [],
        sectors: [],
        priorities: null,
        dependencies: [],
        warnings,
      },
      sourcesIndexed,
      sourcesMapped: sourceBreakdownFrom(bySource),
      gaps: analyzeWorkItemGaps(workItems),
      message:
        workItems.length > 0
          ? `${workItems.length} WorkItems — Live Sync Engine.`
          : "Sin WorkItems — verificar Drive y /api/v1/drive/refresh.",
    };
  }

  async getProductionOverview() {
    const overview = getProductionOverviewFromSnapshot();
    if (!overview) {
      return {
        scannedAt: new Date().toISOString(),
        source: "semanas_2026" as const,
        capacity: null,
        load: null,
        blockers: [],
        sectors: [],
        priorities: null,
        dependencies: [],
        warnings: liveSyncStore.getSnapshot()?.warnings ?? [],
      };
    }
    return overview;
  }

  getSyncStatus() {
    return liveSyncEngine.getStatus();
  }

  forceRefresh() {
    return liveSyncEngine.forceRefresh();
  }
}

function sourceBreakdownFrom(bySource: Record<string, number>) {
  return {
    semanas_2026: bySource.semanas_2026 ?? 0,
    pedidos_2026: bySource.pedidos_2026 ?? 0,
    asignacion_lotes_2026: bySource.asignacion_lotes_2026 ?? 0,
  };
}

export const workItemsService = new WorkItemsService();
