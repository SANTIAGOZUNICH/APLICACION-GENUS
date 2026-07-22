/**
 * @mock-temp Beta Operativa — accesos demo por sector (sin auth real).
 * Un usuario = un sector. Elaboración agrupa ramas Cristian / Nicolás en la vista.
 *
 * Login activo de Genus OS: ocho accesos sectoriales de planta
 * (Elaboración, Producción, Envasado Masivo, Envasado Premium, Calidad,
 * Materias Primas, Codificado, Depósito).
 *
 * Credencial DEPOSITO es temporal / demo (@mock-temp) — no es auth productiva.
 * Dirección NO es acceso activo del login.
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
  /** Solo si se filtra por persona; null = vista de sector completo. */
  ownerPerson?: string | null;
}

export const MOCK_PREVIEW_USERS: MockPreviewUser[] = [
  {
    email: "elaboracion@laboratoriogenus.com.ar",
    password: "elaboracion123",
    sector: "ELABORACION",
    displayName: "Elaboración",
    role: "ROL-EL",
    roleLabel: "Sector",
    sectorLabel: "Elaboración",
    jobTitle: `Encargado: ${SECTOR_PERSONNEL.ELABORACION_ENCARGADO}`,
    redirectTo: "/mi-trabajo",
    ownerPerson: null,
  },
  {
    email: "emasivo@laboratoriogenus.com.ar",
    password: "emasivo123",
    sector: "ENVASADO_MASIVO",
    displayName: SECTOR_PERSONNEL.ENVASADO_MASIVO,
    role: "ROL-OP",
    roleLabel: "Operario",
    sectorLabel: "Envasado Masivo",
    jobTitle: "Responsable Envasado Masivo",
    redirectTo: "/mi-trabajo",
  },
  {
    email: "epremium@laboratoriogenus.com.ar",
    password: "epremium123",
    sector: "ENVASADO_PREMIUM",
    displayName: SECTOR_PERSONNEL.ENVASADO_PREMIUM,
    role: "ROL-OP",
    roleLabel: "Operario",
    sectorLabel: "Envasado Premium",
    jobTitle: "Responsable Envasado Premium",
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
    email: "mp@laboratoriogenus.com.ar",
    password: "mp123",
    sector: "MATERIA_PRIMA",
    displayName: SECTOR_PERSONNEL.MATERIA_PRIMA,
    role: "ROL-OP",
    roleLabel: "Operario",
    sectorLabel: "Materias Primas",
    jobTitle: "Responsable de Materias Primas",
    redirectTo: "/mi-trabajo",
  },
  {
    email: "codificado@laboratoriogenus.com.ar",
    password: "codificado123",
    sector: "CODIFICADO",
    displayName: "Codificado",
    role: "ROL-OP",
    roleLabel: "Operario",
    sectorLabel: "Codificado",
    jobTitle: "Responsable de Codificado",
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
    jobTitle: "Responsable de Depósito (credencial temporal demo)",
    redirectTo: "/mi-trabajo",
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
