/** Responsables operativos por sector — nombres reales del laboratorio. */

export const SECTOR_PERSONNEL = {
  CALIDAD: "Santiago Zunich",
  PRODUCCION: "Agustina Zunich",
  ENVASADO_MASIVO: "Francisco Zapata",
  ENVASADO_PREMIUM: "Belén Ayala",
  DEPOSITO: "Alberto Banini",
  MATERIA_PRIMA: "Lucas Ferreyra",
  ELABORACION_ENCARGADO: "Santino Gianfilippo",
  ELABORACION_RAMA_CRISTIAN: "Cristian",
  ELABORACION_RAMA_NICOLAS: "Nicolás",
} as const;

export const ELABORACION_RAMAS = [
  SECTOR_PERSONNEL.ELABORACION_RAMA_CRISTIAN,
  SECTOR_PERSONNEL.ELABORACION_RAMA_NICOLAS,
] as const;
