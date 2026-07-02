/** F8 — Official operational sectors (Constitution doc 22). */
export const OPERATIONAL_SECTOR_IDS = [
  "ELABORACION",
  "ENVASADO_MASIVO",
  "ENVASADO_PREMIUM",
  "CODIFICADO",
  "MATERIA_PRIMA",
  "CALIDAD",
  "COMERCIAL",
  "DEPOSITO",
  "PRODUCCION",
  "DIRECCION",
] as const;

export type SectorId = (typeof OPERATIONAL_SECTOR_IDS)[number];

/** Sectors available in temporary CurrentSector selector (F8.1). */
export const CURRENT_SECTOR_OPTIONS = [
  "ELABORACION",
  "ENVASADO_MASIVO",
  "ENVASADO_PREMIUM",
  "CODIFICADO",
  "MATERIA_PRIMA",
  "CALIDAD",
  "PRODUCCION",
  "DIRECCION",
] as const satisfies readonly SectorId[];

export type CurrentSectorId = (typeof CURRENT_SECTOR_OPTIONS)[number];

export const SECTOR_LABELS: Record<SectorId, string> = {
  ELABORACION: "Elaboración",
  ENVASADO_MASIVO: "Envasado Masivo",
  ENVASADO_PREMIUM: "Envasado Premium",
  CODIFICADO: "Codificado",
  MATERIA_PRIMA: "Materia Prima",
  CALIDAD: "Calidad",
  COMERCIAL: "Comercial",
  DEPOSITO: "Depósito",
  PRODUCCION: "Producción",
  DIRECCION: "Dirección",
};

export const SECTOR_GREETING: Record<CurrentSectorId, string> = {
  ELABORACION: "Elaboración",
  ENVASADO_MASIVO: "Envasado Masivo",
  ENVASADO_PREMIUM: "Envasado Premium",
  CODIFICADO: "Codificado",
  MATERIA_PRIMA: "Materia Prima",
  CALIDAD: "Calidad",
  PRODUCCION: "Producción",
  DIRECCION: "Dirección",
};
