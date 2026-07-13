import "server-only";

import { operationsDocumentRepository } from "@/lib/adapters/drive/operations-document-repository";
import { sheetsReader } from "@/lib/adapters/sheets/sheets-reader";
import { createWorkItemRegistry } from "@/lib/domain/work-item/work-item-registry";
import { workItemAssembler } from "@/lib/domain/work-item/work-item-assembler";
import {
  projectDomainWorkItems,
  projectQualityItemsFromDomain,
} from "@/lib/domain/work-item/work-item-projector";
import {
  parseDashboardTab,
  type DashboardSnapshot,
  DASHBOARD_TABS,
} from "@/lib/parsers/dashboard-parser";
import { isLoteMonthTab, parseLotesTab } from "@/lib/parsers/lotes-parser";
import { parsePedidosTab, PEDIDOS_TABS } from "@/lib/parsers/pedidos-parser";
import { parsePlannerTab, PLANNER_TABS } from "@/lib/parsers/planner/planner-parser";
import type { QualityItem } from "@/features/os/operational/types";
import type { WorkItem } from "@/types/operational/work-item";

export interface OperationalPipelineResult {
  workItems: WorkItem[];
  qualityItems: QualityItem[];
  dashboard: DashboardSnapshot | null;
  warnings: string[];
  sourcesIndexed: {
    semanas_2026: boolean;
    pedidos_2026: boolean;
    asignacion_lotes_2026: boolean;
  };
}

let cachedDashboard: DashboardSnapshot | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000;

async function readTabIfExists(fileId: string, tabs: string[], candidates: readonly string[]): Promise<{ tab: string; rows: string[][] } | null> {
  const meta = await sheetsReader.getSpreadsheetMeta(fileId);
  for (const candidate of candidates) {
    if (!meta.tabs.includes(candidate)) continue;
    try {
      const rows = await sheetsReader.readTab(fileId, candidate);
      if (rows.length > 0) return { tab: candidate, rows };
    } catch {
      continue;
    }
  }
  for (const tab of meta.tabs) {
    if (tabs.length > 0 && !tabs.includes(tab)) continue;
    try {
      const rows = await sheetsReader.readTab(fileId, tab);
      if (rows.length > 1) return { tab, rows };
    } catch {
      continue;
    }
  }
  return null;
}

/** Pipeline operativo diario: SEMANAS define qué trabajos existen; PEDIDOS/LOTES enriquecen. */
export async function loadOperationalPipeline(): Promise<OperationalPipelineResult> {
  await operationsDocumentRepository.refresh("pcp");

  const registry = createWorkItemRegistry();
  const assembler = workItemAssembler;
  const warnings: string[] = [];

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

  if (semanasRef) {
    const meta = await sheetsReader.getSpreadsheetMeta(semanasRef.fileId);
    const tabs = PLANNER_TABS.filter((t) => meta.tabs.includes(t));
    const toScan = tabs.length > 0 ? tabs : meta.tabs.filter((t) => !["DB", "QACONDDIA", "ENTREGAS"].includes(t.toUpperCase()));

    for (const tab of toScan) {
      try {
        const rows = await sheetsReader.readTab(semanasRef.fileId, tab);
        const result = parsePlannerTab({
          fileId: semanasRef.fileId,
          tab,
          rows,
          registry,
          assembler,
        });
        warnings.push(...result.warnings);
      } catch (err) {
        warnings.push(`SEMANAS/${tab}: ${err instanceof Error ? err.message : "error de lectura"}`);
      }
    }
  } else {
    warnings.push("SEMANAS 2026 no indexado — sin trabajo operativo diario.");
  }

  // PEDIDOS solo enriquece (OP, estado comercial, lote si matchea). No crea trabajos nuevos.
  if (pedidosRef) {
    for (const tab of PEDIDOS_TABS) {
      try {
        const read = await readTabIfExists(pedidosRef.fileId, [tab], [tab]);
        if (!read) continue;
        const result = parsePedidosTab({
          fileId: pedidosRef.fileId,
          tab: read.tab,
          rows: read.rows,
          registry,
          assembler,
        });
        warnings.push(...result.warnings.slice(0, 2));
      } catch (err) {
        warnings.push(`PEDIDOS/${tab}: ${err instanceof Error ? err.message : "error de lectura"}`);
      }
    }

    if (Date.now() - cacheTimestamp > CACHE_TTL_MS) {
      try {
        const dashRead = await readTabIfExists(pedidosRef.fileId, [...DASHBOARD_TABS], ["Dashboard"]);
        if (dashRead) {
          cachedDashboard = parseDashboardTab({
            fileId: pedidosRef.fileId,
            tab: dashRead.tab,
            rows: dashRead.rows,
          });
          cacheTimestamp = Date.now();
        }
      } catch {
        warnings.push("Dashboard PEDIDOS: no se pudo leer KPIs oficiales.");
      }
    }
  } else {
    warnings.push("PEDIDOS 2026 no indexado — OP/estado comercial no disponibles (no bloquea vistas operativas).");
  }

  if (lotesRef) {
    const meta = await sheetsReader.getSpreadsheetMeta(lotesRef.fileId);
    const monthTabs = meta.tabs.filter(isLoteMonthTab);

    for (const tab of monthTabs) {
      try {
        const rows = await sheetsReader.readTab(lotesRef.fileId, tab);
        const result = parseLotesTab({
          fileId: lotesRef.fileId,
          tab,
          rows,
          registry,
          assembler,
        });
        warnings.push(...result.warnings.slice(0, 1));
      } catch (err) {
        warnings.push(`LOTES/${tab}: ${err instanceof Error ? err.message : "error de lectura"}`);
      }
    }
  } else {
    warnings.push("ASIGNACIÓN DE LOTES 2026 no indexado.");
  }

  const domainItems = registry.list();
  const workItems = projectDomainWorkItems(domainItems);
  const qualityItems = projectQualityItemsFromDomain(domainItems);

  return {
    workItems,
    qualityItems,
    dashboard: cachedDashboard,
    warnings,
    sourcesIndexed,
  };
}
