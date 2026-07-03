import type { SectorId } from "@/types/operational/sector";

/** Estado de sesión — preview hasta auth real (PR 4.4+). */
export type AuthSessionStatus = "anonymous" | "preview";

/** Modo de autenticación — extensible en PR 4.4/4.7. */
export type AuthMode = "preview";

/** Identidad mínima resuelta en login (sin permisos RBAC). */
export interface AuthUser {
  email: string;
  displayName: string;
  jobTitle: string;
  company: string;
}

/** Sector operativo asociado a la identidad. */
export interface AuthSector {
  id: SectorId;
  label: string;
}

/** Rol declarativo — enforcement en capas posteriores. */
export interface AuthRole {
  id: string;
  label: string;
}

/** Sesión contractual de Genus OS — identidad + sector + rol. */
export interface OsAuthSession {
  status: AuthSessionStatus;
  mode: AuthMode;
  user: AuthUser;
  sector: AuthSector;
  role: AuthRole;
  rememberMe: boolean;
  redirectTo: string;
  createdAt: string;
}

export interface AuthCredentials {
  email: string;
  password: string;
  rememberMe: boolean;
}
