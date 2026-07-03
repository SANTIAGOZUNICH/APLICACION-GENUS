import { GENUS_COMPANY_NAME } from "../constants";
import type { OsAuthSession } from "../contracts";
import type { SectorId } from "@/types/operational/sector";

/** Clave canónica de sesión preview — PR 4.2+. */
export const GENUS_OS_AUTH_SESSION_KEY = "genus_os_auth_session";

/** @deprecated Clave legacy PR 4.1c — migrada en lectura. */
export const GENUS_OS_PREVIEW_USER_KEY = "genus_os_preview_user";

interface LegacyStoredPreviewUser {
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

function isSectorId(value: string): value is SectorId {
  return [
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
  ].includes(value);
}

function parseSession(raw: string): OsAuthSession | null {
  try {
    const parsed = JSON.parse(raw) as Partial<OsAuthSession> & LegacyStoredPreviewUser;
    if (parsed.status === "preview" && parsed.user && parsed.sector && parsed.role) {
      return parsed as OsAuthSession;
    }
    if (parsed.email && parsed.sector && parsed.displayName) {
      return legacyPreviewUserToSession(parsed as LegacyStoredPreviewUser);
    }
    return null;
  } catch {
    return null;
  }
}

function legacyPreviewUserToSession(legacy: LegacyStoredPreviewUser): OsAuthSession | null {
  if (!isSectorId(legacy.sector)) return null;

  return {
    status: "preview",
    mode: "preview",
    user: {
      email: legacy.email,
      displayName: legacy.displayName,
      jobTitle: legacy.jobTitle,
      company: GENUS_COMPANY_NAME,
    },
    sector: {
      id: legacy.sector,
      label: legacy.sectorLabel,
    },
    role: {
      id: legacy.role,
      label: legacy.roleLabel,
    },
    rememberMe: false,
    redirectTo: legacy.redirectTo,
    createdAt: legacy.storedAt,
  };
}

function readFromStorage(storage: Storage): OsAuthSession | null {
  const canonical = storage.getItem(GENUS_OS_AUTH_SESSION_KEY);
  if (canonical) {
    const session = parseSession(canonical);
    if (session) return session;
  }

  const legacy = storage.getItem(GENUS_OS_PREVIEW_USER_KEY);
  if (!legacy) return null;

  const session = parseSession(legacy);
  if (!session) return null;

  storage.setItem(GENUS_OS_AUTH_SESSION_KEY, JSON.stringify(session));
  storage.removeItem(GENUS_OS_PREVIEW_USER_KEY);
  return session;
}

function getBrowserStorage(): { session: Storage; local: Storage } | null {
  if (typeof window === "undefined") return null;
  return { session: window.sessionStorage, local: window.localStorage };
}

/** Lee sesión preview — sessionStorage tiene prioridad sobre localStorage. */
export function readAuthSessionFromStorage(): OsAuthSession | null {
  const storages = getBrowserStorage();
  if (!storages) return null;

  return readFromStorage(storages.session) ?? readFromStorage(storages.local);
}

/** Persiste sesión — sessionStorage por defecto; localStorage solo con remember me. */
export function writeAuthSessionToStorage(session: OsAuthSession): void {
  const storages = getBrowserStorage();
  if (!storages) return;

  const payload = JSON.stringify(session);
  const target = session.rememberMe ? storages.local : storages.session;
  const other = session.rememberMe ? storages.session : storages.local;

  target.setItem(GENUS_OS_AUTH_SESSION_KEY, payload);
  target.removeItem(GENUS_OS_PREVIEW_USER_KEY);
  other.removeItem(GENUS_OS_AUTH_SESSION_KEY);
  other.removeItem(GENUS_OS_PREVIEW_USER_KEY);
}

/** Limpia sesión preview de ambos storages. */
export function clearAuthSessionStorage(): void {
  const storages = getBrowserStorage();
  if (!storages) return;

  for (const key of [GENUS_OS_AUTH_SESSION_KEY, GENUS_OS_PREVIEW_USER_KEY]) {
    storages.session.removeItem(key);
    storages.local.removeItem(key);
  }
}

/** Utilidad de tests — inyecta storages en memoria. */
export function readAuthSessionFromStorages(
  sessionStorage: Storage,
  localStorage: Storage
): OsAuthSession | null {
  return readFromStorage(sessionStorage) ?? readFromStorage(localStorage);
}

export function writeAuthSessionToStorages(
  session: OsAuthSession,
  sessionStorage: Storage,
  localStorage: Storage
): void {
  const payload = JSON.stringify(session);
  const target = session.rememberMe ? localStorage : sessionStorage;
  const other = session.rememberMe ? sessionStorage : localStorage;

  target.setItem(GENUS_OS_AUTH_SESSION_KEY, payload);
  target.removeItem(GENUS_OS_PREVIEW_USER_KEY);
  other.removeItem(GENUS_OS_AUTH_SESSION_KEY);
  other.removeItem(GENUS_OS_PREVIEW_USER_KEY);
}

export function clearAuthSessionStorages(sessionStorage: Storage, localStorage: Storage): void {
  for (const key of [GENUS_OS_AUTH_SESSION_KEY, GENUS_OS_PREVIEW_USER_KEY]) {
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
  }
}
