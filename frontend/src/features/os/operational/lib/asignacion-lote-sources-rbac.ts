import type { SectorId } from "@/types/operational/sector";

/**
 * Configurar fuentes de sincronización (conectar/desconectar planillas) es
 * una decisión administrativa — más restrictiva que
 * `canAccessAsignacionLotes` (Calidad/Producción/Codificado, que solo
 * consumen los datos). Sectores operativos nunca gestionan fuentes.
 */
const ASIGNACION_LOTE_SOURCES_CONFIG_ALLOWED_SECTORS = new Set<SectorId>(["PRODUCCION", "DIRECCION"]);

export function canConfigureAsignacionLoteSources(sectorId: SectorId | null | undefined): boolean {
  return Boolean(sectorId && ASIGNACION_LOTE_SOURCES_CONFIG_ALLOWED_SECTORS.has(sectorId));
}
