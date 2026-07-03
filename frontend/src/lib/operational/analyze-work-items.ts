import type { SectorId } from "@/types/operational/sector";
import { OPERATIONAL_SECTOR_IDS } from "@/types/operational/sector";
import type { WorkItem } from "@/types/operational/work-item";

const GAP_FIELDS: Array<{ key: keyof WorkItem; label: string }> = [
  { key: "priority", label: "prioridad" },
  { key: "date", label: "fecha" },
  { key: "dayLabel", label: "día" },
  { key: "client", label: "cliente" },
  { key: "product", label: "producto" },
  { key: "quantity", label: "cantidad" },
  { key: "line", label: "línea" },
  { key: "pedidoRef", label: "ref pedido" },
  { key: "oeRef", label: "ref OE" },
  { key: "oaRef", label: "ref OA" },
  { key: "loteRef", label: "ref lote" },
  { key: "dependsOn", label: "dependsOn" },
  { key: "blockedBy", label: "blockedBy" },
  { key: "unblocks", label: "unblocks" },
];

export function countWorkItemsBySector(
  items: WorkItem[]
): Partial<Record<SectorId, number>> {
  const counts: Partial<Record<SectorId, number>> = {};
  for (const item of items) {
    counts[item.sector] = (counts[item.sector] ?? 0) + 1;
  }
  return counts;
}

export function countWorkItemsBySource(
  items: WorkItem[]
): Partial<Record<WorkItem["source"], number>> {
  const counts: Partial<Record<WorkItem["source"], number>> = {};
  for (const item of items) {
    counts[item.source] = (counts[item.source] ?? 0) + 1;
  }
  return counts;
}

export function countWorkItemsByOriginStage(
  items: WorkItem[]
): Partial<Record<WorkItem["originStage"], number>> {
  const counts: Partial<Record<WorkItem["originStage"], number>> = {};
  for (const item of items) {
    counts[item.originStage] = (counts[item.originStage] ?? 0) + 1;
  }
  return counts;
}

export function countWorkItemsByPriority(items: WorkItem[]): Record<string, number> {
  const counts: Record<string, number> = { null: 0 };
  for (const item of items) {
    const key = item.priority ?? "null";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function countWorkItemsByConfidence(
  items: WorkItem[]
): Partial<Record<WorkItem["confidence"], number>> {
  const counts: Partial<Record<WorkItem["confidence"], number>> = {};
  for (const item of items) {
    counts[item.confidence] = (counts[item.confidence] ?? 0) + 1;
  }
  return counts;
}

export function analyzeWorkItemGaps(items: WorkItem[]) {
  const totalCount = items.length;
  if (totalCount === 0) return [];

  return GAP_FIELDS.map(({ key, label }) => {
    const missingCount = items.filter((item) => {
      const value = item[key];
      if (value === null || value === undefined) return true;
      if (Array.isArray(value) && value.length === 0) return true;
      if (typeof value === "string" && !value.trim()) return true;
      return false;
    }).length;

    return { field: label, missingCount, totalCount };
  })
    .filter((gap) => gap.missingCount > 0)
    .sort((a, b) => b.missingCount - a.missingCount);
}

export function summarizeDependencies(items: WorkItem[]) {
  let withDependsOn = 0;
  let withBlockedBy = 0;
  let withUnblocks = 0;

  const dependencyItems = items.map((item) => {
    if (item.dependsOn?.length) withDependsOn += 1;
    if (item.blockedBy?.length) withBlockedBy += 1;
    if (item.unblocks?.length) withUnblocks += 1;

    return {
      workItemId: item.id,
      product: item.product,
      sector: item.sector,
      dependsOn: item.dependsOn,
      blockedBy: item.blockedBy,
      unblocks: item.unblocks,
    };
  });

  return {
    withDependsOn,
    withBlockedBy,
    withUnblocks,
    chainNote:
      "F8.1: dependencias sectoriales (Elaboración → Envasado → Codificado → Calidad → Depósito) se documentan en doc 22 §4.6. Los mappers aún no las infieren — valores null hasta F12.",
    items: dependencyItems.filter(
      (item) => item.dependsOn?.length || item.blockedBy?.length || item.unblocks?.length
    ),
  };
}

export function emptySectorCounts(): Partial<Record<SectorId, number>> {
  return Object.fromEntries(OPERATIONAL_SECTOR_IDS.map((s) => [s, 0])) as Partial<
    Record<SectorId, number>
  >;
}
