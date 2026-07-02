import "server-only";

import { operationsDocumentRepository } from "@/lib/adapters/drive/operations-document-repository";
import { loadSemanasWorkItems } from "@/lib/mappers/semanas-to-work-items";
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
import {
  countMiTrabajoSections,
  filterWorkItemsForSector,
  partitionMiTrabajoSections,
} from "@/lib/operational/work-item-filters";
import { SECTOR_PREVIEW_PROFILES } from "@/config/sector-preview";
import { SECTOR_GREETING, type SectorId } from "@/types/operational/sector";
import type { WorkItem } from "@/types/operational/work-item";
import type { WorkItemsResponse } from "@/types/operational/work-item";
import type {
  WorkItemsDebugResponse,
  WorkItemsPreviewResponse,
} from "@/types/operational/work-items-preview.types";

interface LoadedWorkItems {
  workItems: WorkItem[];
  warnings: string[];
  sourcesIndexed: {
    semanas_2026: boolean;
    pedidos_2026: boolean;
    asignacion_lotes_2026: boolean;
  };
}

export class WorkItemsService {
  private async loadAllWorkItems(): Promise<LoadedWorkItems> {
    await operationsDocumentRepository.refresh("pcp");

    const [semanasRef, pedidosRef, lotesRef] = await Promise.all([
      operationsDocumentRepository.tryGetCriticalSheetRef("semanas_2026"),
      operationsDocumentRepository.tryGetCriticalSheetRef("pedidos_2026"),
      operationsDocumentRepository.tryGetCriticalSheetRef("asignacion_lotes_2026"),
    ]);

    const sourcesIndexed = {
      semanas_2026: Boolean(semanasRef),
      pedidos_2026: Boolean(pedidosRef),
      asignacion_lotes_2026: Boolean(lotesRef),
    };

    if (!semanasRef) {
      return {
        workItems: [],
        warnings: ["SEMANAS 2026 no indexado. Ejecutá GET /api/v1/drive/refresh."],
        sourcesIndexed,
      };
    }

    const { workItems, warnings } = await loadSemanasWorkItems(semanasRef);
    return { workItems, warnings, sourcesIndexed };
  }

  async listForSector(sector: SectorId): Promise<WorkItemsResponse> {
    const { workItems, warnings, sourcesIndexed } = await this.loadAllWorkItems();

    if (!sourcesIndexed.semanas_2026) {
      return {
        sector,
        source: "drive",
        scannedAt: new Date().toISOString(),
        workItems: [],
        counts: { total: 0, hoy: 0, semana: 0, pendientes: 0, bloqueados: 0 },
        message: "SEMANAS 2026 no indexado — sin WorkItems reales.",
        warnings,
      };
    }

    const filtered = filterWorkItemsForSector(workItems, sector);

    return {
      sector,
      source: "drive",
      scannedAt: new Date().toISOString(),
      workItems: filtered,
      counts: countMiTrabajoSections(filtered),
      warnings: warnings.slice(0, 10),
      message:
        filtered.length > 0
          ? `${filtered.length} WorkItem(s) para ${sector} desde SEMANAS 2026.`
          : "No hay trabajos asignados para este sector en SEMANAS 2026.",
    };
  }

  async getPreviewForSector(sector: SectorId): Promise<WorkItemsPreviewResponse> {
    const { workItems, warnings, sourcesIndexed } = await this.loadAllWorkItems();
    const profileConfig = SECTOR_PREVIEW_PROFILES[sector];
    const filtered = filterWorkItemsForSector(workItems, sector);
    const sections = partitionMiTrabajoSections(filtered);
    const bySource = countWorkItemsBySource(workItems);
    const bySector = countWorkItemsBySector(workItems);

    const sourceBreakdown = {
      semanas_2026: bySource.semanas_2026 ?? 0,
      pedidos_2026: 0,
      asignacion_lotes_2026: 0,
    };

    const expectedSources =
      profileConfig?.expectedSources.map((src) => ({
        ...src,
        indexed: sourcesIndexed[src.key],
        workItemCount:
          src.key === "semanas_2026"
            ? sourceBreakdown.semanas_2026
            : src.key === "pedidos_2026"
              ? 0
              : 0,
      })) ?? [];

    const productionOverview =
      sector === "PRODUCCION"
        ? buildProductionOverview(workItems)
        : undefined;

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
          : sector === "CALIDAD"
            ? "Calidad no recibe WorkItems desde SEMANAS en F8.1 — fuente principal: ASIGNACION DE LOTES (mapper F8.2)."
            : "No hay trabajos asignados para este sector en SEMANAS 2026.",
      productionOverview,
      globalStats: {
        totalAllSectors: workItems.length,
        bySector,
        byOriginStage: countWorkItemsByOriginStage(workItems),
      },
    };
  }

  async getDebugSnapshot(): Promise<WorkItemsDebugResponse> {
    const { workItems, warnings, sourcesIndexed } = await this.loadAllWorkItems();
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
      sourcesMapped: {
        semanas_2026: bySource.semanas_2026 ?? 0,
        pedidos_2026: 0,
        asignacion_lotes_2026: 0,
      },
      gaps: analyzeWorkItemGaps(workItems),
      message:
        workItems.length > 0
          ? `${workItems.length} WorkItems desde SEMANAS 2026. PEDIDOS y LOTES pendientes F8.2.`
          : "Sin WorkItems — verificar Drive y /api/v1/drive/refresh.",
    };
  }

  async getProductionOverview() {
    const { workItems, warnings } = await this.loadAllWorkItems();
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

export const workItemsService = new WorkItemsService();
