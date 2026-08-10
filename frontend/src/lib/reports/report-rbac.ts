import type { SectorId } from "@/types/operational/sector";

/**
 * Acceso al reporte gerencial — roles reales existentes en el sistema.
 * No existe un sector/rol formal "Administración": el sistema solo tiene
 * `sector` (PRODUCCION/DIRECCION/etc.) y un allowlist de emails superadmin
 * (ver isSuperadminEmail). Se interpretó "Administración" como DIRECCION
 * (el sector de supervisión/gerencia real) — decisión documentada acá y en
 * el informe final, no se inventó un rol nuevo.
 */
const ALLOWED_SECTORS: ReadonlySet<SectorId> = new Set(["PRODUCCION", "DIRECCION"]);

export function canAccessManagementReport(
  sector: SectorId | string | null | undefined,
  isSuperadmin: boolean
): boolean {
  if (isSuperadmin) return true;
  return typeof sector === "string" && ALLOWED_SECTORS.has(sector as SectorId);
}
