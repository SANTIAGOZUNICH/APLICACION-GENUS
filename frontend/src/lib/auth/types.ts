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
  | "SESSION_EXPIRED"
  | "ADMIN_USER_UPDATE"
  | "ADMIN_PASSWORD_RESET"
  | "ADMIN_SESSIONS_REVOKED";

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

/** Recurso oculto / no autorizado como superadmin — mapear a 404 en HTTP. */
export class AuthNotFoundError extends Error {
  readonly status = 404;
  readonly code = "AUTH_NOT_FOUND";
  constructor(message = "No encontrado.") {
    super(message);
    this.name = "AuthNotFoundError";
  }
}

export class AuthConflictError extends Error {
  readonly status = 409;
  readonly code = "AUTH_CONFLICT";
  constructor(message = "Conflicto de datos.") {
    super(message);
    this.name = "AuthConflictError";
  }
}

export class AuthValidationError extends Error {
  readonly status = 400;
  readonly code = "AUTH_VALIDATION";
  constructor(message = "Datos inválidos.") {
    super(message);
    this.name = "AuthValidationError";
  }
}

/**
 * Backend de sesión durable no disponible en un entorno multi-instancia
 * (Vercel). Nunca debe resolverse cayendo en silencio a memoria de
 * proceso — eso rompe la autenticación de forma intermitente según qué
 * instancia serverless atienda cada request. Ver get-auth-service.ts.
 */
export class AuthBackendUnavailableError extends Error {
  readonly status = 503;
  readonly code = "AUTH_BACKEND_UNAVAILABLE";
  constructor(
    message = "Backend de sesión durable no disponible. Configuración incompleta."
  ) {
    super(message);
    this.name = "AuthBackendUnavailableError";
  }
}

export function toPublicAuthUser(user: AuthUser): PublicAuthUser {
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return publicUser;
}
