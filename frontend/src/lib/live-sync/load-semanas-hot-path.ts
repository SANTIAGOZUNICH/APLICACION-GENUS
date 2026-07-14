import "server-only";

import { createWorkItemRegistry } from "@/lib/domain/work-item/work-item-registry";
import { workItemAssembler } from "@/lib/domain/work-item/work-item-assembler";
import { projectDomainWorkItems } from "@/lib/domain/work-item/work-item-projector";
import { parsePlannerTab, PLANNER_TABS } from "@/lib/parsers/planner/planner-parser";
import {
  countMiTrabajoSections,
  filterWorkItemsByDate,
  filterWorkItemsByWeekStart,
  filterWorkItemsForSectorAndPerson,
} from "@/lib/operational/work-item-filters";
import { serverOperationalState } from "@/lib/live-sync/server-operational-state";
import type { SectorId } from "@/types/operational/sector";
import type { WorkItem } from "@/types/operational/work-item";

export interface SemanasTabPayload {
  tab: string;
  rows: string[][];
}

export interface SemanasHotParseResult {
  workItems: WorkItem[];
  warnings: string[];
  parseDurationMs: number;
}

/** PlannerParser puro sobre filas ya leídas — sin Pedidos/Lotes/Dashboard/Drive. */
export function parseSemanasTabsToWorkItems(
  fileId: string,
  tabs: SemanasTabPayload[]
): SemanasHotParseResult {
  const started = Date.now();
  const registry = createWorkItemRegistry();
  const warnings: string[] = [];

  const preferred = new Set(PLANNER_TABS.map((t) => t.toUpperCase()));
  const ordered = [
    ...tabs.filter((t) => preferred.has(t.tab.toUpperCase())),
    ...tabs.filter((t) => !preferred.has(t.tab.toUpperCase())),
  ];

  for (const { tab, rows } of ordered) {
    if (!rows.length) continue;
    try {
      const result = parsePlannerTab({
        fileId,
        tab,
        rows,
        registry,
        assembler: workItemAssembler,
      });
      warnings.push(...result.warnings);
    } catch (err) {
      warnings.push(
        `SEMANAS/${tab}: ${err instanceof Error ? err.message : "error de parse"}`
      );
    }
  }

  return {
    workItems: projectDomainWorkItems(registry.list()),
    warnings,
    parseDurationMs: Date.now() - started,
  };
}

export interface CheckProjectionInput {
  sector: SectorId;
  ownerPerson?: string | null;
  date?: string | null;
  weekStart?: string | null;
}

export interface CheckProjectionResult {
  workItems: WorkItem[];
  counts: ReturnType<typeof countMiTrabajoSections>;
  projectDurationMs: number;
}

/** Proyección mínima por request (sector / persona / fecha). */
export function projectWorkItemsForCheck(
  allItems: WorkItem[],
  input: CheckProjectionInput
): CheckProjectionResult {
  const started = Date.now();
  let filtered = filterWorkItemsForSectorAndPerson(
    allItems,
    input.sector,
    input.ownerPerson ?? null
  );

  if (input.date) {
    filtered = filterWorkItemsByDate(filtered, input.date);
  } else if (input.weekStart) {
    filtered = filterWorkItemsByWeekStart(filtered, input.weekStart);
  }

  const withOverlay = serverOperationalState.applyToWorkItems(filtered);
  return {
    workItems: withOverlay,
    counts: countMiTrabajoSections(withOverlay),
    projectDurationMs: Date.now() - started,
  };
}
