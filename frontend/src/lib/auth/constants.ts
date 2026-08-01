/** Config estática de sesión — Genus Auth (0016). */

/** Duración de sesión: 12 horas (turno de planta). */
export const SESSION_TTL_SECONDS = 12 * 3600;

/** Nombre de la cookie de sesión (HttpOnly). */
export const COOKIE_NAME = "genus_session";

/** Header legacy usado por vitest/harness de tests (NUNCA identidad en Preview real). */
export const ACTOR_EMAIL_HEADER = "x-genus-actor-email";
export const ACTOR_SECTOR_HEADER = "x-genus-actor-sector";

/** Costo de bcrypt para el hash de contraseñas. */
export const PASSWORD_HASH_COST = 12;

/** Máximo de intentos fallidos de login antes de rate-limit temporal. */
export const LOGIN_MAX_FAILS = 8;

/** Ventana de rate-limit de intentos fallidos de login (15 minutos). */
export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
