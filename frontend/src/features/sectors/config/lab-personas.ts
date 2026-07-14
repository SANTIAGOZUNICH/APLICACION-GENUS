import type { SectorId } from "@/types/operational/sector";
import { SECTOR_PERSONNEL } from "@/features/os/operational/lib/sector-personnel";

/** Referencia de ramas SEMANAS — no son credenciales de login. */
export const ELABORACION_ENCARGADO = SECTOR_PERSONNEL.ELABORACION_ENCARGADO;

export const ELABORACION_RAMA_LABELS = [
  SECTOR_PERSONNEL.ELABORACION_RAMA_CRISTIAN,
  SECTOR_PERSONNEL.ELABORACION_RAMA_NICOLAS,
] as const;

/** Sectores con acceso demo en preview Beta (login por email de sector). */
export const LAB_SECTOR_PREVIEW_ORDER: SectorId[] = [
  "ELABORACION",
  "ENVASADO_MASIVO",
  "ENVASADO_PREMIUM",
  "CALIDAD",
  "PRODUCCION",
  "DEPOSITO",
  "DIRECCION",
];
