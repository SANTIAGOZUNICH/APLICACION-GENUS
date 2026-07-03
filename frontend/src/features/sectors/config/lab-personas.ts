import type { SectorId } from "@/types/operational/sector";
import { SECTOR_PERSONNEL } from "@/features/os/operational/lib/sector-personnel";

/** Personas del laboratorio para login simulado F10.1 — mapeadas a bloques SEMANAS. */
export interface LabPersona {
  id: string;
  name: string;
  email: string;
  sectorId: SectorId;
  /** Nombre tal como aparece en SEMANAS (bloque visual). */
  semanasLabel: string;
}

export const ELABORACION_ENCARGADO = SECTOR_PERSONNEL.ELABORACION_ENCARGADO;

export const LAB_PERSONAS: LabPersona[] = [
  {
    id: "cristian",
    name: SECTOR_PERSONNEL.ELABORACION_RAMA_CRISTIAN,
    email: "cristian@laboratoriogenus.com.ar",
    sectorId: "ELABORACION",
    semanasLabel: SECTOR_PERSONNEL.ELABORACION_RAMA_CRISTIAN,
  },
  {
    id: "nicolas",
    name: SECTOR_PERSONNEL.ELABORACION_RAMA_NICOLAS,
    email: "nicolas@laboratoriogenus.com.ar",
    sectorId: "ELABORACION",
    semanasLabel: SECTOR_PERSONNEL.ELABORACION_RAMA_NICOLAS,
  },
];

export const LAB_SECTOR_PREVIEW_ORDER: SectorId[] = [
  "ENVASADO_MASIVO",
  "ENVASADO_PREMIUM",
  "PRODUCCION",
];
