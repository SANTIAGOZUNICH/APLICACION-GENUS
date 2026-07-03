/**
 * @mock-temp Fase 4 Access Preview — usuarios de demostración internos.
 * Reemplazar por USUARIOS/API en auth real. Sin hashing — solo preview UI.
 */

import { SECTOR_PERSONNEL } from "@/features/os/operational/lib/sector-personnel";

export interface MockPreviewUser {
  email: string;
  password: string;
  sector: string;
  displayName: string;
  role: string;
  roleLabel: string;
  sectorLabel: string;
  jobTitle: string;
  redirectTo: string;
  /** Elaborador en SEMANAS — filtra mi-trabajo por persona. */
  ownerPerson?: string | null;
}

export const MOCK_PREVIEW_USERS: MockPreviewUser[] = [
  {
    email: "produccion@laboratoriogenus.com.ar",
    password: "produccion123",
    sector: "PRODUCCION",
    displayName: SECTOR_PERSONNEL.PRODUCCION,
    role: "ROL-SU",
    roleLabel: "Supervisora",
    sectorLabel: "Producción",
    jobTitle: "Supervisora de Planta",
    redirectTo: "/mi-trabajo",
  },
  {
    email: "calidad@laboratoriogenus.com.ar",
    password: "calidad123",
    sector: "CALIDAD",
    displayName: SECTOR_PERSONNEL.CALIDAD,
    role: "ROL-CA",
    roleLabel: "Calidad",
    sectorLabel: "Calidad",
    jobTitle: "Responsable de Calidad",
    redirectTo: "/mi-trabajo",
  },
  {
    email: "deposito@laboratoriogenus.com.ar",
    password: "deposito123",
    sector: "DEPOSITO",
    displayName: SECTOR_PERSONNEL.DEPOSITO,
    role: "ROL-OP",
    roleLabel: "Operario",
    sectorLabel: "Depósito",
    jobTitle: "Responsable de Depósito",
    redirectTo: "/mi-trabajo",
  },
  {
    email: "direccion@laboratoriogenus.com.ar",
    password: "direccion123",
    sector: "DIRECCION",
    displayName: "Santiago Zunich",
    role: "ROL-DI",
    roleLabel: "Dirección",
    sectorLabel: "Dirección",
    jobTitle: "Director General",
    redirectTo: "/mi-trabajo",
  },
  {
    email: "masivo@laboratoriogenus.com.ar",
    password: "masivo123",
    sector: "ENVASADO_MASIVO",
    displayName: SECTOR_PERSONNEL.ENVASADO_MASIVO,
    role: "ROL-OP",
    roleLabel: "Operario",
    sectorLabel: "Envasado Masivo",
    jobTitle: "Responsable Envasado Masivo",
    redirectTo: "/mi-trabajo",
  },
  {
    email: "premium@laboratoriogenus.com.ar",
    password: "premium123",
    sector: "ENVASADO_PREMIUM",
    displayName: SECTOR_PERSONNEL.ENVASADO_PREMIUM,
    role: "ROL-OP",
    roleLabel: "Operario",
    sectorLabel: "Envasado Premium",
    jobTitle: "Responsable Envasado Premium",
    redirectTo: "/mi-trabajo",
  },
  {
    email: "santino@laboratoriogenus.com.ar",
    password: "santino123",
    sector: "ELABORACION",
    displayName: SECTOR_PERSONNEL.ELABORACION_ENCARGADO,
    role: "ROL-EL",
    roleLabel: "Encargado",
    sectorLabel: "Elaboración",
    jobTitle: "Encargado de Elaboración",
    redirectTo: "/mi-trabajo",
    ownerPerson: null,
  },
  {
    email: "cristian@laboratoriogenus.com.ar",
    password: "cristian123",
    sector: "ELABORACION",
    displayName: SECTOR_PERSONNEL.ELABORACION_RAMA_CRISTIAN,
    role: "ROL-EL",
    roleLabel: "Elaborador",
    sectorLabel: "Elaboración",
    jobTitle: `Elaborador · Rama ${SECTOR_PERSONNEL.ELABORACION_RAMA_CRISTIAN}`,
    redirectTo: "/mi-trabajo",
    ownerPerson: SECTOR_PERSONNEL.ELABORACION_RAMA_CRISTIAN,
  },
  {
    email: "nicolas@laboratoriogenus.com.ar",
    password: "nicolas123",
    sector: "ELABORACION",
    displayName: SECTOR_PERSONNEL.ELABORACION_RAMA_NICOLAS,
    role: "ROL-EL",
    roleLabel: "Elaborador",
    sectorLabel: "Elaboración",
    jobTitle: `Elaborador · Rama ${SECTOR_PERSONNEL.ELABORACION_RAMA_NICOLAS}`,
    redirectTo: "/mi-trabajo",
    ownerPerson: SECTOR_PERSONNEL.ELABORACION_RAMA_NICOLAS,
  },
];

export function findMockUserByEmail(email: string): MockPreviewUser | undefined {
  const normalized = email.trim().toLowerCase();
  return MOCK_PREVIEW_USERS.find((user) => user.email.toLowerCase() === normalized);
}

export function validateMockPreviewCredentials(
  email: string,
  password: string
): MockPreviewUser | null {
  const user = findMockUserByEmail(email);
  if (!user || user.password !== password) return null;
  return user;
}

export const PREVIEW_AUTH_ERROR =
  "No pudimos validar las credenciales. Revisá el mail o la contraseña.";
