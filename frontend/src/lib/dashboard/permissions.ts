/**
 * Matriz de permisos del Dashboard operativo. La decide SIEMPRE el servidor (service.ts / routes), nunca el cliente.
 *
 *  - PRODUCCION, DIRECCION → nivel «full»: todo (incluye clientes, ranking, comparación y lead time por cliente);
 *    son los únicos que pueden filtrar por cliente y editar objetivos.
 *  - Todos los demás sectores (Envasado Masivo/Premium, Elaboración, Codificado, Calidad, Materia Prima, Depósito,
 *    Comercial) → nivel «aggregate»: totales agregados de la planta (unidades, productos distintos, pedidos
 *    activos/en despacho/entregados, evolución mensual) SIN nombres de clientes y sin indicadores de servicio
 *    (nivel de servicio, lead time, reclamos), que quedan «No disponible para tu sector».
 */
import type { DashboardAccessLevel, DashboardPermissions } from "./types";

const FULL_SECTORS: ReadonlySet<string> = new Set(["PRODUCCION", "DIRECCION"]);

export function dashboardLevelFor(sector: string): DashboardAccessLevel {
  return FULL_SECTORS.has(String(sector ?? "").toUpperCase()) ? "full" : "aggregate";
}

export function resolveDashboardPermissions(sector: string): DashboardPermissions {
  const s = String(sector ?? "").toUpperCase();
  const level = dashboardLevelFor(s);
  return {
    level,
    canEditTargets: level === "full",
    canFilterClient: level === "full",
    ownSector: s === "ENVASADO_MASIVO" || s === "ENVASADO_PREMIUM" ? s : null,
  };
}

export const NOT_AVAILABLE_FOR_SECTOR = "No disponible para tu sector.";
export const CLIENTS_NOT_AVAILABLE_REASON =
  "No disponible para tu sector: los datos por cliente son solo para Producción y Dirección.";
