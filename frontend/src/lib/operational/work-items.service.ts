import "server-only";

import { loadOperationalPipeline } from "@/lib/parsers/load-operational-pipeline";
import {
  countMiTrabajoSections,
  filterWorkItemsForSectorAndPerson,
  filterWorkItemsForSector,
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
import { buildProductionOverview } from "@/lib/operational/build-production-overview";
import { SECTOR_PREVIEW_PROFILES } from "@/config/sector-preview";
import { SECTOR_GREETING, type SectorId } from "@/types/operational/sector";
import type { WorkItem } from "@/types/operational/work-item";
import type { WorkItemsResponse } from "@/types/operational/work-item";
import type {
  WorkItemsDebugResponse,
  WorkItemsPreviewResponse,
} from "@/types/operational/work-items-preview.types";
import type { QualityItem } from "@/features/os/operational/types";

interface LoadedOperationalData {
  workItems: WorkItem[];
  qualityItems: QualityItem[];
  warnings: string[];
  sourcesIndexed: {
    semanas_2026: boolean;
    pedidos_2026: boolean;
    asignacion_lotes_2026: boolean;
  };
}

export class WorkItemsService {
  private cache: LoadedOperationalData | null = null;
  private cacheAt = 0;
  private readonly cacheTtlMs = 45_000;

  private async loadAll(): Promise<LoadedOperationalData> {
    if (this.cache && Date.now() - this.cacheAt < this.cacheTtlMs) {
      return this.cache;
    }

    const pipeline = await loadOperationalPipeline();
    this.cache = {
      workItems: pipeline.workItems,
      qualityItems: pipeline.qualityItems,
      warnings: pipeline.warnings,
      sourcesIndexed: pipeline.sourcesIndexed,
    };
    this.cacheAt = Date.now();
    return this.cache;
  }

  async listForSector(sector: SectorId, ownerPerson?: string | null): Promise<WorkItemsResponse> {
    const { workItems, qualityItems, warnings, sourcesIndexed } = await this.loadAll();

    const hasAnySource = Object.values(sourcesIndexed).some(Boolean);
    if (!hasAnySource) {
      return {
        sector,
        ownerPerson: ownerPerson ?? null,
        source: "drive",
        scannedAt: new Date().toISOString(),
        workItems: [],
        qualityItems: [],
        counts: { total: 0, hoy: 0, semana: 0, pendientes: 0, bloqueados: 0 },
        message: "Sin fuentes indexadas — ejecutá GET /api/v1/drive/refresh.",
        warnings,
      };
    }

    const filtered = filterWorkItemsForSectorAndPerson(workItems, sector, ownerPerson);

    return {
      sector,
      ownerPerson: ownerPerson ?? null,
      source: "drive",
      scannedAt: new Date().toISOString(),
      workItems: filtered,
      qualityItems: sector === "CALIDAD" ? qualityItems : [],
      counts: countMiTrabajoSections(filtered),
      warnings: warnings.slice(0, 10),
      message:
        filtered.length > 0
          ? `${filtered.length} WorkItem(s) para ${sector}${ownerPerson ? ` · ${ownerPerson}` : ""}.`
          : `Sin trabajos para ${sector}${ownerPerson ? ` · ${ownerPerson}` : ""} en Sheets indexados.`,
    };
  }

  async getPreviewForSector(sector: SectorId): Promise<WorkItemsPreviewResponse> {
    const { workItems, warnings, sourcesIndexed } = await this.loadAll();
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
      sector === "PRODUCCION" ? buildProductionOverview(workItems) : undefined;

    if (productionOverview) {
      productionOverview.warnings = warnings.slice(0, 10);
    }

    return {
      sector,
      scannedAt: new Date().toISOString(),
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
    const { workItems, warnings, sourcesIndexed } = await this.loadAll();
    const bySource = countWorkItemsBySource(workItems);
    const overview = buildProductionOverview(workItems);
    overview.warnings = warnings.slice(0, 20);

    const deps = summarizeDependencies(workItems);

    return {
      scannedAt: new Date().toISOString(),
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
      productionOverview: overview,
      sourcesIndexed,
      sourcesMapped: sourceBreakdownFrom(bySource),
      gaps: analyzeWorkItemGaps(workItems),
      message:
        workItems.length > 0
          ? `${workItems.length} WorkItems desde pipeline operativo (SEMANAS + PEDIDOS + LOTES).`
          : "Sin WorkItems — verificar Drive y /api/v1/drive/refresh.",
    };
  }

  async getProductionOverview() {
    const { workItems, warnings } = await this.loadAll();
    if (workItems.length === 0) {
      return {
        scannedAt: new Date().toISOString(),
        source: "semanas_2026" as const,
        capacity: null,
        load: null,
        blockers: [],
        sectors: [],
        priorities: null,
        dependencies: [],
        warnings,
      };
    }
    const overview = buildProductionOverview(workItems);
    overview.warnings = warnings.slice(0, 10);
    return overview;
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
