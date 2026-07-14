import type { SectorId } from "@/types/operational/sector";

/** Emails simulados por sector — login F9.6 sin autenticación real. */
export const SECTOR_EMAILS: Record<SectorId, string> = {
  ELABORACION: "elaboracion@laboratoriogenus.com.ar",
  ENVASADO_MASIVO: "masivo@laboratoriogenus.com.ar",
  ENVASADO_PREMIUM: "premium@laboratoriogenus.com.ar",
  CODIFICADO: "codificado@laboratoriogenus.com.ar",
  MATERIA_PRIMA: "mp@laboratoriogenus.com.ar",
  CALIDAD: "calidad@laboratoriogenus.com.ar",
  COMERCIAL: "comercial@laboratoriogenus.com.ar",
  DEPOSITO: "deposito@laboratoriogenus.com.ar",
  PRODUCCION: "produccion@laboratoriogenus.com.ar",
  DIRECCION: "direccion@laboratoriogenus.com.ar",
};

/** Sectores disponibles en login simulado (orden de planta). */
export const LOGIN_SECTOR_ORDER: SectorId[] = [
  "ELABORACION",
  "ENVASADO_MASIVO",
  "ENVASADO_PREMIUM",
  "CODIFICADO",
  "CALIDAD",
  "DEPOSITO",
  "MATERIA_PRIMA",
  "COMERCIAL",
  "PRODUCCION",
  "DIRECCION",
];
