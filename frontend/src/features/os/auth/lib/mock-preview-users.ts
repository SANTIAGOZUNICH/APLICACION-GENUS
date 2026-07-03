/**
 * @mock-temp Fase 4 Access Preview — usuarios de demostración internos.
 * Reemplazar por USUARIOS/API en auth real. Sin hashing — solo preview UI.
 */

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
    displayName: "María Producción",
    role: "ROL-SU",
    roleLabel: "Supervisor",
    sectorLabel: "Producción",
    jobTitle: "Supervisora de Planta",
    redirectTo: "/mi-trabajo",
  },
  {
    email: "calidad@laboratoriogenus.com.ar",
    password: "calidad123",
    sector: "CALIDAD",
    displayName: "Lucía Calidad",
    role: "ROL-CA",
    roleLabel: "Calidad",
    sectorLabel: "Calidad",
    jobTitle: "Analista de Calidad",
    redirectTo: "/mi-trabajo",
  },
  {
    email: "deposito@laboratoriogenus.com.ar",
    password: "deposito123",
    sector: "DEPOSITO",
    displayName: "Belén Depósito",
    role: "ROL-OP",
    roleLabel: "Operario",
    sectorLabel: "Depósito",
    jobTitle: "Operaria de Depósito",
    redirectTo: "/mi-trabajo",
  },
  {
    email: "direccion@laboratoriogenus.com.ar",
    password: "direccion123",
    sector: "DIRECCION",
    displayName: "Santiago Dirección",
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
    displayName: "Operario Masivo",
    role: "ROL-OP",
    roleLabel: "Operario",
    sectorLabel: "Envasado Masivo",
    jobTitle: "Operario de Línea Masivo",
    redirectTo: "/mi-trabajo",
  },
  {
    email: "premium@laboratoriogenus.com.ar",
    password: "premium123",
    sector: "ENVASADO_PREMIUM",
    displayName: "Operario Premium",
    role: "ROL-OP",
    roleLabel: "Operario",
    sectorLabel: "Envasado Premium",
    jobTitle: "Operario de Línea Premium",
    redirectTo: "/mi-trabajo",
  },
  {
    email: "cristian@laboratoriogenus.com.ar",
    password: "cristian123",
    sector: "ELABORACION",
    displayName: "Cristian",
    role: "ROL-EL",
    roleLabel: "Elaborador",
    sectorLabel: "Elaboración",
    jobTitle: "Elaborador",
    redirectTo: "/mi-trabajo",
    ownerPerson: "Cristian",
  },
  {
    email: "nicolas@laboratoriogenus.com.ar",
    password: "nicolas123",
    sector: "ELABORACION",
    displayName: "Nicolás",
    role: "ROL-EL",
    roleLabel: "Elaborador",
    sectorLabel: "Elaboración",
    jobTitle: "Elaborador",
    redirectTo: "/mi-trabajo",
    ownerPerson: "Nicolás",
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
