import "server-only";

import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import { computeDashboard } from "./compute";
import { loadDashboardData } from "./data-source";
import { dashboardLevelFor } from "./permissions";
import { listDashboardTargets, type DashboardActor } from "./targets-service";
import { DASHBOARD_SECTOR_FILTERS, type DashboardFilters, type DashboardPayload, type DashboardSectorFilter } from "./types";
import { toArDate } from "./compute";

export type DashboardQuery = {
  year?: string | null;
  month?: string | null;
  sector?: string | null;
  client?: string | null;
};

/** Valida los filtros. Lanza OrdersValidationError (400) ante valores inválidos. */
export function parseDashboardFilters(q: DashboardQuery, nowIso: string): DashboardFilters {
  const currentYear = Number((toArDate(nowIso) ?? nowIso).slice(0, 4));
  let year = currentYear;
  if (q.year != null && q.year !== "") {
    const y = Number(q.year);
    if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new OrdersValidationError("Año inválido.");
    year = y;
  }
  let month: number | null = null;
  if (q.month != null && q.month !== "" && q.month !== "ALL") {
    const m = Number(q.month);
    if (!Number.isInteger(m) || m < 1 || m > 12) throw new OrdersValidationError("Mes inválido.");
    month = m;
  }
  let sector: DashboardSectorFilter = "ALL";
  if (q.sector != null && q.sector !== "") {
    if (!(DASHBOARD_SECTOR_FILTERS as readonly string[]).includes(q.sector)) throw new OrdersValidationError("Sector inválido.");
    sector = q.sector as DashboardSectorFilter;
  }
  const client = q.client?.trim() ? q.client.trim().slice(0, 200) : null;
  return { year, month, sector, client };
}

/**
 * Payload del Dashboard ya recortado según el sector del actor (el servidor decide).
 * Un sector sin acceso a clientes que pida el filtro por cliente recibe 403 (no se ignora en silencio).
 */
export async function getDashboard(actor: DashboardActor, query: DashboardQuery): Promise<DashboardPayload> {
  const generatedAt = new Date().toISOString();
  const filters = parseDashboardFilters(query, generatedAt);
  const level = dashboardLevelFor(actor.sector);
  if (level !== "full" && filters.client) {
    throw new OrdersForbiddenError("El filtro por cliente es solo para Producción y Dirección.");
  }
  const [data, targets] = await Promise.all([loadDashboardData(), listDashboardTargets()]);
  return computeDashboard(data.rows, filters, {
    level,
    sector: actor.sector,
    targets: targets.targets,
    generatedAt,
    lastDataChangeAt: data.lastDataChangeAt,
    targetsSchemaPending: targets.schemaPending,
    dataSource: data.dataSource,
  });
}
