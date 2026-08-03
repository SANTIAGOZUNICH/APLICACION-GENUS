import type { SectorId } from "@/types/operational/sector";

export const FORMULA_ADMIN_ALLOWED_SECTORS = [
  "CALIDAD",
  "PRODUCCION",
  "MATERIA_PRIMA",
  "DIRECCION",
] as const satisfies readonly SectorId[];

export type FormulaAdminAllowedSector = (typeof FORMULA_ADMIN_ALLOWED_SECTORS)[number];

export const FORMULA_ADMIN_DENIED_MESSAGE =
  "Solo Calidad, Producción o Materia Prima pueden administrar el banco de fórmulas.";

export function canManageFormulas(sector: SectorId | null | undefined): boolean {
  return Boolean(
    sector && (FORMULA_ADMIN_ALLOWED_SECTORS as readonly string[]).includes(sector)
  );
}

export function assertFormulaAdminAccess(sector: SectorId): void {
  if (!canManageFormulas(sector)) {
    throw new Error(FORMULA_ADMIN_DENIED_MESSAGE);
  }
}
