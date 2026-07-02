import type { SectorId } from "@/types/operational/sector";

/** Personas del laboratorio para login simulado F10.1 — mapeadas a bloques SEMANAS. */
export interface LabPersona {
  id: string;
  name: string;
  email: string;
  sectorId: SectorId;
  /** Nombre tal como aparece en SEMANAS (bloque visual). */
  semanasLabel: string;
}

export const LAB_PERSONAS: LabPersona[] = [
  {
    id: "cristian",
    name: "Cristian",
    email: "cristian@laboratoriogenus.com.ar",
    sectorId: "ELABORACION",
    semanasLabel: "Cristian",
  },
  {
    id: "nicolas",
    name: "Nicolás",
    email: "nicolas@laboratoriogenus.com.ar",
    sectorId: "ELABORACION",
    semanasLabel: "Nicolás",
  },
];

export const LAB_SECTOR_PREVIEW_ORDER: SectorId[] = [
  "ENVASADO_MASIVO",
  "ENVASADO_PREMIUM",
  "PRODUCCION",
];
