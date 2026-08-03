import type { PlanningSector } from "@/lib/planning/types";
import type { SectorId } from "@/types/operational/sector";

const FLOOR_PLAN_SECTORS: PlanningSector[] = [
  "ELABORACION",
  "ENVASADO_MASIVO",
  "ENVASADO_PREMIUM",
];

/** Sectores de sesión que pueden consultar planes compartidos RO. */
export type WeeklyPlanViewerSector = "CODIFICADO" | "DEPOSITO" | "MATERIA_PRIMA";

const ALLOWLIST: Record<WeeklyPlanViewerSector, PlanningSector[]> = {
  CODIFICADO: ["ENVASADO_MASIVO", "ENVASADO_PREMIUM"],
  DEPOSITO: ["ENVASADO_MASIVO", "ENVASADO_PREMIUM"],
  MATERIA_PRIMA: ["ELABORACION"],
};

export function isWeeklyPlanViewerSector(sector: string): sector is WeeklyPlanViewerSector {
  return sector === "CODIFICADO" || sector === "DEPOSITO" || sector === "MATERIA_PRIMA";
}

export function getAllowedPlanSectors(actorSector: string): PlanningSector[] {
  if (!isWeeklyPlanViewerSector(actorSector)) return [];
  return [...ALLOWLIST[actorSector]];
}

export function isFloorPlanSector(value: string): value is PlanningSector {
  return (FLOOR_PLAN_SECTORS as string[]).includes(value);
}

/**
 * Resuelve sectores SQL a consultar.
 * - planSector omitido → todos los permitidos para el actor.
 * - planSector pedido fuera de allowlist → null (caller responde 403).
 */
export function resolveRequestedPlanSectors(
  actorSector: string,
  planSector: string | null | undefined
): PlanningSector[] | null {
  const allowed = getAllowedPlanSectors(actorSector);
  if (allowed.length === 0) return null;

  if (!planSector || planSector === "ALL" || planSector === "TODOS") {
    return allowed;
  }

  const normalized = planSector.trim().toUpperCase();
  if (!isFloorPlanSector(normalized)) return null;
  if (!allowed.includes(normalized)) return null;
  return [normalized];
}

export function canAccessSharedWeeklyPlans(actorSector: SectorId | string): boolean {
  return getAllowedPlanSectors(String(actorSector)).length > 0;
}
