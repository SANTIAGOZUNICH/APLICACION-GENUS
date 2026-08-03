/** Tipos de dominio para Genus Auth (sesiones enterprise por sector, 0016). */

export type AuthUserStatus = "ACTIVO" | "BLOQUEADO" | "INACTIVO";

/**
 * Usuario de autenticación persistido (o en memoria hasta 0016).
 * `passwordHash` nunca debe salir de `src/lib/auth` hacia el resto de la app.
 */
export interface AuthUser {
  id: string;
  email: string;
  emailNormalized: string;
  displayName: string;
  sector: string;
  roleId: string;
  roleLabel: string;
  sectorLabel: string;
  jobTitle: string;
  status: AuthUserStatus;
  passwordHash: string;
  redirectTo: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

/** Vista pública de un usuario — nunca incluye passwordHash. */
export type PublicAuthUser = Omit<AuthUser, "passwordHash">;

export interface AuthSession {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
  userAgent: string | null;
  ipHash: string | null;
}

/** Identidad resuelta de un request autenticado — lo único que debe cruzar hacia orders/planning/inventory. */
export interface AuthActor {
  userId: string;
  email: string;
  sector: string;
  displayName: string;
  roleId: string;
  roleLabel: string;
  sectorLabel: string;
  jobTitle: string;
  redirectTo: string;
}

export type AuthEventType =
  | "LOGIN_OK"
  | "LOGIN_FAIL"
  | "LOGOUT"
  | "BLOCKED"
  | "SESSION_EXPIRED";

export interface AuthAuditEvent {
  id: string;
  eventType: AuthEventType;
  emailNormalized: string | null;
  userId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface LoginMeta {
  userAgent?: string | null;
  ipHash?: string | null;
  rememberMe?: boolean;
}

export interface LoginResult {
  user: PublicAuthUser;
  token: string;
  expiresAt: string;
}

export class AuthUnauthorizedError extends Error {
  readonly status = 401;
  readonly code = "AUTH_UNAUTHORIZED";
  constructor(message = "Sesión requerida.") {
    super(message);
    this.name = "AuthUnauthorizedError";
  }
}

export class AuthInvalidCredentialsError extends Error {
  readonly status = 401;
  readonly code = "AUTH_INVALID_CREDENTIALS";
  constructor(
    message = "No pudimos validar las credenciales. Revisá el mail o la contraseña."
  ) {
    super(message);
    this.name = "AuthInvalidCredentialsError";
  }
}

export class AuthBlockedError extends Error {
  readonly status = 403;
  readonly code = "AUTH_BLOCKED";
  constructor(message = "Usuario bloqueado. Contactá a Producción/Dirección.") {
    super(message);
    this.name = "AuthBlockedError";
  }
}

export class AuthRateLimitedError extends Error {
  readonly status = 429;
  readonly code = "AUTH_RATE_LIMITED";
  constructor(message = "Demasiados intentos fallidos. Probá de nuevo en unos minutos.") {
    super(message);
    this.name = "AuthRateLimitedError";
  }
}

export function toPublicAuthUser(user: AuthUser): PublicAuthUser {
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return publicUser;
}
