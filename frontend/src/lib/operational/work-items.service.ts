import "server-only";

import { operationsDocumentRepository } from "@/lib/adapters/drive/operations-document-repository";
import { loadSemanasWorkItems } from "@/lib/mappers/semanas-to-work-items";
import { buildProductionOverview } from "@/lib/operational/build-production-overview";
import {
  countMiTrabajoSections,
  filterWorkItemsForSector,
} from "@/lib/operational/work-item-filters";
import type { SectorId } from "@/types/operational/sector";
import type { WorkItemsResponse } from "@/types/operational/work-item";
import type { ProductionOverview } from "@/types/operational/production-overview";

export class WorkItemsService {
  async listForSector(sector: SectorId): Promise<WorkItemsResponse> {
    await operationsDocumentRepository.refresh("pcp");
    const docRef = await operationsDocumentRepository.tryGetCriticalSheetRef("semanas_2026");

    if (!docRef) {
      return {
        sector,
        source: "drive",
        scannedAt: new Date().toISOString(),
        workItems: [],
        counts: { total: 0, hoy: 0, semana: 0, pendientes: 0, bloqueados: 0 },
        message: "SEMANAS 2026 no indexado — sin WorkItems reales.",
        warnings: ["Ejecutá /api/v1/drive/refresh."],
      };
    }

    const { workItems, warnings } = await loadSemanasWorkItems(docRef);
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

  async getProductionOverview(): Promise<ProductionOverview> {
    await operationsDocumentRepository.refresh("pcp");
    const docRef = await operationsDocumentRepository.tryGetCriticalSheetRef("semanas_2026");

    if (!docRef) {
      return {
        scannedAt: new Date().toISOString(),
        source: "semanas_2026",
        capacity: null,
        load: null,
        blockers: [],
        sectors: [],
        priorities: null,
        dependencies: [],
        warnings: ["SEMANAS 2026 no indexado."],
      };
    }

    const { workItems, warnings } = await loadSemanasWorkItems(docRef);
    const overview = buildProductionOverview(workItems);
    overview.warnings = warnings.slice(0, 10);
    return overview;
  }
}

export const workItemsService = new WorkItemsService();
