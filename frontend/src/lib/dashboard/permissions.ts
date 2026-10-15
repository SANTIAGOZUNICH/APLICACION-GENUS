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

/**
 * Responsables de Métricas (mínimo privilegio). Métricas solo es accesible para Envasado + Producción
 * (`canAccessMetricas`) y NO se amplía. El Dashboard sí muestra a TODOS los sectores los totales agregados de unidades
 * envasadas (sin personas), pero los NOMBRES de responsables salen solo para:
 *  - PRODUCCION y DIRECCION → todos los registros (Dirección ya ve clientes; acá es solo lectura);
 *  - ENVASADO_MASIVO / ENVASADO_PREMIUM → únicamente los registros de SU sector (lo mismo que ya ve en Métricas);
 *  - el resto de los sectores → ningún nombre (el servidor ni siquiera los incluye en el payload).
 */
export type ResponsiblesScope = "all" | "ENVASADO_MASIVO" | "ENVASADO_PREMIUM" | null;

export function responsiblesScopeFor(sector: string): ResponsiblesScope {
  const s = String(sector ?? "").toUpperCase();
  if (s === "PRODUCCION" || s === "DIRECCION") return "all";
  if (s === "ENVASADO_MASIVO" || s === "ENVASADO_PREMIUM") return s;
  return null;
}

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
    responsiblesScope: responsiblesScopeFor(s),
  };
}

export const RESPONSIBLES_NOT_AVAILABLE_REASON =
  "No disponible para tu sector: los nombres de responsables son solo para Producción, Dirección y los sectores de Envasado (cada uno ve el suyo).";
export const RESPONSIBLES_OTHER_SECTOR_REASON =
  "No disponible: solo ves a los responsables de tu propio sector de Envasado. Cambiá el filtro de sector o dejalo en «Todos».";
export const NOT_AVAILABLE_FOR_SECTOR = "No disponible para tu sector.";
export const CLIENTS_NOT_AVAILABLE_REASON =
  "No disponible para tu sector: los datos por cliente son solo para Producción y Dirección.";
