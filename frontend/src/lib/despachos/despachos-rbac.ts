/** RBAC — Depósito «Entregas Producción». Depósito carga/edita/elimina; Producción y Dirección consultan. */
import type { SectorId } from "@/types/operational/sector";

const READ_SECTORS = new Set<SectorId>(["DEPOSITO", "PRODUCCION", "DIRECCION"]);

export function canAccessDespachos(sectorId: SectorId | null | undefined): boolean {
  return Boolean(sectorId && READ_SECTORS.has(sectorId));
}

export function canMutateDespachos(sectorId: SectorId | null | undefined): boolean {
  return sectorId === "DEPOSITO";
}
