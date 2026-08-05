/** RBAC — Depósito Graneles (sobrantes de granel; migración 0014). */
import type { SectorId } from "@/types/operational/sector";

const ENVASADO_SECTORS = new Set<SectorId>(["ENVASADO_MASIVO", "ENVASADO_PREMIUM"]);

/** Lectura: Depósito (dueño del módulo) + sectores de origen/relacionados. */
const GRANELES_READ_SECTORS = new Set<SectorId>([
  "DEPOSITO",
  "ENVASADO_MASIVO",
  "ENVASADO_PREMIUM",
  "PRODUCCION",
  "DIRECCION",
]);

export function canAccessGraneles(sectorId: SectorId | null | undefined): boolean {
  return Boolean(sectorId && GRANELES_READ_SECTORS.has(sectorId));
}

/** Alta manual / edición / eliminación-anulación: solo Depósito. */
export function canMutateGraneles(sectorId: SectorId | null | undefined): boolean {
  return sectorId === "DEPOSITO";
}

/** Upsert idempotente desde Envasado (Finalizar / Enviar a Codificado con sobrante). */
export function canUpsertGranelFromEnvasado(sectorId: SectorId | null | undefined): boolean {
  return Boolean(sectorId && (ENVASADO_SECTORS.has(sectorId) || sectorId === "DEPOSITO"));
}
