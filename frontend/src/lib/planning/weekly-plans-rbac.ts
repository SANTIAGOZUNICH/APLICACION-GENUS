import type { PlanningSector } from "@/lib/planning/types";
import type { SectorId } from "@/types/operational/sector";

const FLOOR_PLAN_SECTORS: PlanningSector[] = [
  "ELABORACION",
  "ENVASADO_MASIVO",
  "ENVASADO_PREMIUM",
];

/**
 * Sectores de sesión que pueden CONSULTAR la planificación de piso (Vista mensual y planes compartidos). Es SOLO LECTURA:
 * esta ruta no escribe nada, así que consultar no otorga ningún permiso de asignación ni de edición.
 * Todos los sectores con una bandeja operativa ven Premium, Masivo y Elaboración; Administración/Facturación no.
 */
const VIEWER_SECTORS: readonly string[] = [
  "PRODUCCION",
  "DIRECCION",
  "COMERCIAL",
  "ELABORACION",
  "ENVASADO_MASIVO",
  "ENVASADO_PREMIUM",
  "CODIFICADO",
  "DEPOSITO",
  "MATERIA_PRIMA",
  "CALIDAD",
];

/** Qué trae el plan compartido SEMANAL cuando no se pide un sector (comportamiento histórico de cada vista). */
const LEGACY_DEFAULT: Record<string, PlanningSector[]> = {
  CODIFICADO: ["ENVASADO_MASIVO", "ENVASADO_PREMIUM"],
  DEPOSITO: ["ENVASADO_MASIVO", "ENVASADO_PREMIUM"],
  MATERIA_PRIMA: ["ELABORACION"],
};

export type WeeklyPlanViewerSector = string;

export function isWeeklyPlanViewerSector(sector: string): boolean {
  return VIEWER_SECTORS.includes(sector);
}

/** Sectores de piso que el actor PUEDE consultar (pidiéndolos explícitamente). */
export function getAllowedPlanSectors(actorSector: string): PlanningSector[] {
  return isWeeklyPlanViewerSector(actorSector) ? [...FLOOR_PLAN_SECTORS] : [];
}

export function isFloorPlanSector(value: string): value is PlanningSector {
  return (FLOOR_PLAN_SECTORS as string[]).includes(value);
}

/**
 * Resuelve sectores SQL a consultar.
 * - planSector omitido / ALL → el conjunto histórico de cada vista (Codificado y Depósito: Envasado; MP: Elaboración; el resto: los tres).
 * - planSector pedido fuera de los sectores de piso o de un actor sin acceso → null (el llamador responde 403).
 */
export function resolveRequestedPlanSectors(
  actorSector: string,
  planSector: string | null | undefined
): PlanningSector[] | null {
  const allowed = getAllowedPlanSectors(actorSector);
  if (allowed.length === 0) return null;

  if (!planSector || planSector === "ALL" || planSector === "TODOS") {
    return [...(LEGACY_DEFAULT[actorSector] ?? allowed)];
  }

  const normalized = planSector.trim().toUpperCase();
  if (!isFloorPlanSector(normalized)) return null;
  if (!allowed.includes(normalized)) return null;
  return [normalized];
}

export function canAccessSharedWeeklyPlans(actorSector: SectorId | string): boolean {
  return getAllowedPlanSectors(String(actorSector)).length > 0;
}
