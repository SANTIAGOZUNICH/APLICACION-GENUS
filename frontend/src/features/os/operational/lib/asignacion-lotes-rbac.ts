import type { SectorId } from "@/types/operational/sector";

const ASIGNACION_LOTES_ALLOWED_SECTORS = new Set<SectorId>([
  "CALIDAD",
  "PRODUCCION",
  "CODIFICADO",
]);

export function canAccessAsignacionLotes(sectorId: SectorId | null | undefined): boolean {
  return Boolean(sectorId && ASIGNACION_LOTES_ALLOWED_SECTORS.has(sectorId));
}

export function canMutateAsignacionLotes(sectorId: SectorId | null | undefined): boolean {
  return canAccessAsignacionLotes(sectorId);
}
