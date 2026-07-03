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
}

export const GENUS_OS_PREVIEW_USER_KEY = "genus_os_preview_user";

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

export interface StoredPreviewUser {
  email: string;
  sector: string;
  displayName: string;
  role: string;
  roleLabel: string;
  sectorLabel: string;
  jobTitle: string;
  redirectTo: string;
  storedAt: string;
}

export function persistPreviewUser(
  user: MockPreviewUser,
  rememberMe: boolean
): void {
  if (typeof window === "undefined") return;
  const payload: StoredPreviewUser = {
    email: user.email,
    sector: user.sector,
    displayName: user.displayName,
    role: user.role,
    roleLabel: user.roleLabel,
    sectorLabel: user.sectorLabel,
    jobTitle: user.jobTitle,
    redirectTo: user.redirectTo,
    storedAt: new Date().toISOString(),
  };
  const storage = rememberMe ? window.localStorage : window.sessionStorage;
  storage.setItem(GENUS_OS_PREVIEW_USER_KEY, JSON.stringify(payload));
}

export const PREVIEW_AUTH_ERROR =
  "No pudimos validar las credenciales. Revisá el mail o la contraseña.";
