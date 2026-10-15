import "server-only";

/**
 * Fuente única de unidades ENVASADAS del Dashboard = módulo Métricas (packaging_metrics).
 *
 * Se lee con `MetricasService.list` (la MISMA función que usa la pantalla de Métricas): solo registros activos
 * (`deleted_at` nulo), sin ninguna caché propia → altas, ediciones, importaciones, borrados y restauraciones de Métricas se
 * reflejan en la siguiente consulta del Dashboard.
 *
 * SOLO LECTURA y solo en el servidor. Métricas sigue restringida a Envasado + Producción (`canAccessMetricas`); el
 * Dashboard no amplía ese permiso: lee con una identidad interna de Producción y el servidor recorta el payload
 * (totales agregados para todos, nombres de responsables según `responsiblesScopeFor`).
 */
import { isProcedureMetricsSchemaReady } from "@/lib/db/procedure-metrics-schema";
import { getMetricasService } from "@/lib/metricas/metricas-service";
import type { MetricsActor } from "@/lib/metricas/types";
import type { DashboardMetricRow } from "./types";

const DASHBOARD_READER: MetricsActor = { email: "dashboard@genus.internal", sector: "PRODUCCION" };

export type DashboardMetricsData = {
  rows: DashboardMetricRow[];
  /** Último `updated_at` de los registros leídos. */
  lastChangeAt: string | null;
  schemaPending: boolean;
};

export async function loadDashboardMetrics(year: number): Promise<DashboardMetricsData> {
  const schemaReady = await isProcedureMetricsSchemaReady();
  const records = await getMetricasService().list(DASHBOARD_READER, {
    dateFrom: `${year}-01-01`,
    dateTo: `${year}-12-31`,
    sector: "ALL",
  });
  let last: string | null = null;
  const rows: DashboardMetricRow[] = records.map((r) => {
    if (!last || r.updatedAt > last) last = r.updatedAt;
    return {
      sector: r.sector,
      metricDate: r.metricDate,
      units: r.units,
      responsibleKey: r.responsibleKey,
      responsibleDisplay: r.responsibleDisplay,
      updatedAt: r.updatedAt,
      deletedAt: r.deletedAt,
    };
  });
  return { rows, lastChangeAt: last, schemaPending: !schemaReady };
}
