/**
 * Directorio de cuentas por sector — Genus Auth (0016).
 *
 * Campos públicos únicamente (email, sector, displayName, rol, labels,
 * redirectTo). Migrado de `mock-preview-users.ts` **sin** el campo
 * `password`: acá nunca se declara ni se importa ninguna contraseña en
 * texto plano. Las contraseñas viven exclusivamente como hashes bcrypt en
 * `genus_auth_users.password_hash` (o en memoria de test), sembradas desde
 * variables de entorno por `scripts/seed-genus-auth.mjs`.
 *
 * Ocho accesos sectoriales de planta (Elaboración, Producción, Envasado
 * Masivo, Envasado Premium, Calidad, Materias Primas, Codificado,
 * Depósito). Dirección no es acceso activo del login.
 */

import { SECTOR_PERSONNEL } from "@/features/os/operational/lib/sector-personnel";

export interface SectorAccountDirectoryEntry {
  email: string;
  sector: string;
  displayName: string;
  role: string;
  roleLabel: string;
  sectorLabel: string;
  jobTitle: string;
  redirectTo: string;
}

export const SECTOR_ACCOUNT_DIRECTORY: SectorAccountDirectoryEntry[] = [
  {
    email: "elaboracion@laboratoriogenus.com.ar",
    sector: "ELABORACION",
    displayName: "Elaboración",
    role: "ROL-EL",
    roleLabel: "Sector",
    sectorLabel: "Elaboración",
    jobTitle: `Encargado: ${SECTOR_PERSONNEL.ELABORACION_ENCARGADO}`,
    redirectTo: "/mi-trabajo",
  },
  {
    email: "emasivo@laboratoriogenus.com.ar",
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
    sector: "DEPOSITO",
    displayName: SECTOR_PERSONNEL.DEPOSITO,
    role: "ROL-OP",
    roleLabel: "Operario",
    sectorLabel: "Depósito",
    jobTitle: "Responsable de Depósito (credencial temporal demo)",
    redirectTo: "/mi-trabajo",
  },
];

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function findDirectoryEntryByEmail(
  email: string
): SectorAccountDirectoryEntry | undefined {
  const normalized = normalizeEmail(email);
  return SECTOR_ACCOUNT_DIRECTORY.find(
    (entry) => normalizeEmail(entry.email) === normalized
  );
}
