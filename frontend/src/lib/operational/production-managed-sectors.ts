import type { SectorId } from "@/types/operational/sector";

/**
 * Única definición de los sectores que Producción gestiona directamente
 * (asigna, ve, edita, elimina/cancela). Antes esta misma lista vivía
 * hardcodeada, por separado, en el panel general, en Entregados, en el
 * historial y en el filtro agregado de work-item-filters.ts — agregar o
 * quitar un sector implicaba acordarse de todos esos archivos a mano (así
 * quedó afuera CODIFICADO más de una vez). Todo lo demás debe derivar de
 * esta constante en lugar de repetir el array.
 */
export const PRODUCTION_MANAGED_SECTORS = [
  "ELABORACION",
  "ENVASADO_MASIVO",
  "ENVASADO_PREMIUM",
  "CODIFICADO",
] as const satisfies readonly SectorId[];

export type ProductionManagedSectorId = (typeof PRODUCTION_MANAGED_SECTORS)[number];

export function isProductionManagedSector(
  sector: SectorId | string | null | undefined
): sector is ProductionManagedSectorId {
  return (PRODUCTION_MANAGED_SECTORS as readonly string[]).includes(String(sector ?? ""));
}
