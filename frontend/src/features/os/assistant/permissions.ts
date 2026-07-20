import type { SectorId } from "@/types/operational/sector";

export type CreamyAccessDomain =
  | "works"
  | "lots"
  | "rawMaterials"
  | "orders_oe"
  | "orders_oa"
  | "quality"
  | "deliveries"
  | "help";

const ALL_DOMAINS = new Set<CreamyAccessDomain>([
  "works",
  "lots",
  "rawMaterials",
  "orders_oe",
  "orders_oa",
  "quality",
  "deliveries",
  "help",
]);

const DOMAIN_MATRIX: Partial<Record<SectorId, ReadonlySet<CreamyAccessDomain>>> = {
  PRODUCCION: ALL_DOMAINS,
  CALIDAD: new Set(["works", "lots", "orders_oe", "orders_oa", "quality", "deliveries", "help"]),
  DIRECCION: new Set(["deliveries", "help"]),
  ELABORACION: new Set(["works", "orders_oe", "help"]),
  ENVASADO_MASIVO: new Set(["works", "orders_oa", "help"]),
  ENVASADO_PREMIUM: new Set(["works", "orders_oa", "help"]),
  MATERIA_PRIMA: new Set(["rawMaterials", "orders_oe", "help"]),
  CODIFICADO: new Set(["lots", "help"]),
};

/**
 * Limitación actual: actorSectorId llega desde el cliente y no reemplaza auth/RBAC server-side.
 * El servidor vuelve a aplicar esta matriz antes de devolver resultados sensibles.
 */
export function canCreamyAccessDomain(
  sectorId: SectorId | null | undefined,
  domain: CreamyAccessDomain
): boolean {
  if (!sectorId) return false;
  return DOMAIN_MATRIX[sectorId]?.has(domain) ?? false;
}

export function isOwnWorkOnlySector(sectorId: SectorId): boolean {
  return (
    sectorId === "ELABORACION" ||
    sectorId === "ENVASADO_MASIVO" ||
    sectorId === "ENVASADO_PREMIUM"
  );
}
