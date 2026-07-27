import type { SectorId } from "@/types/operational/sector";

export const METRICS_SECTORS = ["ENVASADO_MASIVO", "ENVASADO_PREMIUM"] as const;
export type MetricsSector = (typeof METRICS_SECTORS)[number];

export type PackagingMetricRecord = {
  id: string;
  sector: MetricsSector;
  metricDate: string;
  product: string | null;
  units: number;
  responsibleDisplay: string;
  responsibleKey: string;
  workItemId: string | null;
  createdBy: string;
  createdBySector: SectorId;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type MetricsActor = { email: string; sector: SectorId };

export type MetricsListFilters = {
  dateFrom?: string;
  dateTo?: string;
  product?: string;
  responsible?: string;
};

export type MetricsRankingEntry = {
  responsibleKey: string;
  responsibleDisplay: string;
  totalUnits: number;
  recordCount: number;
};

export function canAccessMetricas(sector: SectorId): sector is MetricsSector {
  return sector === "ENVASADO_MASIVO" || sector === "ENVASADO_PREMIUM";
}

/** Normaliza responsable para agrupación (case/spaces). */
export function normalizeResponsibleKey(display: string): string {
  return display.trim().toLowerCase().replace(/\s+/g, " ");
}

export function computeRanking(
  records: PackagingMetricRecord[]
): MetricsRankingEntry[] {
  const map = new Map<string, MetricsRankingEntry>();
  for (const r of records) {
    const key = r.responsibleKey || normalizeResponsibleKey(r.responsibleDisplay);
    const existing = map.get(key);
    if (existing) {
      existing.totalUnits += r.units;
      existing.recordCount += 1;
      if (r.responsibleDisplay.length > existing.responsibleDisplay.length) {
        existing.responsibleDisplay = r.responsibleDisplay;
      }
    } else {
      map.set(key, {
        responsibleKey: key,
        responsibleDisplay: r.responsibleDisplay,
        totalUnits: r.units,
        recordCount: 1,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.totalUnits - a.totalUnits);
}

export function computeTotals(records: PackagingMetricRecord[]): {
  totalUnits: number;
  recordCount: number;
} {
  return {
    totalUnits: records.reduce((s, r) => s + r.units, 0),
    recordCount: records.length,
  };
}
