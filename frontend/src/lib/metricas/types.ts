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
  /** Solo Producción: filtrar Masivo/Premium; omitir = todos. */
  sector?: MetricsSector | "ALL";
  /** Si true, lista solo soft-deleted (para restaurar). */
  onlyDeleted?: boolean;
};

export type MetricsRankingEntry = {
  responsibleKey: string;
  responsibleDisplay: string;
  totalUnits: number;
  recordCount: number;
  /** Presente cuando el ranking cruza sectores. */
  sector?: MetricsSector;
  sectorBreakdown?: Partial<Record<MetricsSector, number>>;
};

export function canAccessMetricas(sector: SectorId): boolean {
  return (
    sector === "ENVASADO_MASIVO" ||
    sector === "ENVASADO_PREMIUM" ||
    sector === "PRODUCCION"
  );
}

export function isMetricsEnvasadoSector(sector: SectorId): sector is MetricsSector {
  return sector === "ENVASADO_MASIVO" || sector === "ENVASADO_PREMIUM";
}

export function canAdminAllMetricas(sector: SectorId): boolean {
  return sector === "PRODUCCION";
}

/** Normaliza responsable para agrupación (case/spaces). */
export function normalizeResponsibleKey(display: string): string {
  return display.trim().toLowerCase().replace(/\s+/g, " ");
}

export function computeRanking(
  records: PackagingMetricRecord[],
  opts?: { includeSector?: boolean }
): MetricsRankingEntry[] {
  const map = new Map<string, MetricsRankingEntry>();
  for (const r of records) {
    const keyBase = r.responsibleKey || normalizeResponsibleKey(r.responsibleDisplay);
    const key = opts?.includeSector ? `${keyBase}::${r.sector}` : keyBase;
    const existing = map.get(key);
    if (existing) {
      existing.totalUnits += r.units;
      existing.recordCount += 1;
      if (r.responsibleDisplay.length > existing.responsibleDisplay.length) {
        existing.responsibleDisplay = r.responsibleDisplay;
      }
      if (!opts?.includeSector) {
        if (!existing.sectorBreakdown) existing.sectorBreakdown = {};
        existing.sectorBreakdown[r.sector] =
          (existing.sectorBreakdown[r.sector] ?? 0) + r.units;
      }
    } else {
      map.set(key, {
        responsibleKey: keyBase,
        responsibleDisplay: r.responsibleDisplay,
        totalUnits: r.units,
        recordCount: 1,
        sector: opts?.includeSector ? r.sector : undefined,
        sectorBreakdown: opts?.includeSector
          ? undefined
          : { [r.sector]: r.units },
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
