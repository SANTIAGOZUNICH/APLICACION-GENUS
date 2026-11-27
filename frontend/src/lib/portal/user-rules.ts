/**
 * Reglas PURAS (sin E/S) del ingreso al portal por usuario + contraseña: normalización del usuario, política de contraseña,
 * bloqueo progresivo por intentos fallidos y generación de contraseñas temporales. El hash (bcrypt) vive en
 * `@/lib/auth/password`, el mismo que usa GENUS OS: no hay un segundo esquema de hash.
 */
import { randomInt } from "node:crypto";

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 40;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

/** Minúsculas, sin espacios alrededor. Solo letras, números, punto, guion y guion bajo; empieza con letra o número. null = inválido. */
export function normalizeUsername(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const t = input.trim().toLowerCase();
  if (t.length < USERNAME_MIN || t.length > USERNAME_MAX) return null;
  return /^[a-z0-9][a-z0-9._-]*$/.test(t) ? t : null;
}

export type PasswordProblem = "corta" | "larga" | "sin_letra" | "sin_numero" | "igual_al_usuario" | "comun";
const COMMON = new Set(["1234567890", "contraseña1", "password123", "qwertyuiop1", "genus12345", "laboratorio1", "abcdefghij1", "0123456789"]);

/** null = aceptable. Pide largo mínimo, una letra y un número; rechaza el propio usuario y claves triviales. */
export function passwordProblem(password: unknown, username?: string | null): PasswordProblem | null {
  if (typeof password !== "string" || password.length < PASSWORD_MIN) return "corta";
  if (password.length > PASSWORD_MAX) return "larga";
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñÜü]/.test(password)) return "sin_letra";
  if (!/\d/.test(password)) return "sin_numero";
  const low = password.toLowerCase();
  if (username && (low === username.toLowerCase() || low.includes(username.toLowerCase()))) return "igual_al_usuario";
  if (COMMON.has(low) || /^(.)\1+$/.test(low)) return "comun";
  return null;
}

export const PASSWORD_PROBLEM_MESSAGES: Record<PasswordProblem, string> = {
  corta: `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`,
  larga: `La contraseña no puede superar los ${PASSWORD_MAX} caracteres.`,
  sin_letra: "La contraseña debe incluir al menos una letra.",
  sin_numero: "La contraseña debe incluir al menos un número.",
  igual_al_usuario: "La contraseña no puede contener el nombre de usuario.",
  comun: "Elegí una contraseña menos predecible.",
};

/** Sin 0/O/1/I/l: se dicta por teléfono sin confusiones. Cumple la política (largo 12, letras y números). */
const TEMP_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
const TEMP_DIGITS = "23456789";
export function generateTemporaryPassword(length = 12): string {
  const n = Math.max(PASSWORD_MIN, length);
  const chars: string[] = [];
  for (let i = 0; i < n; i++) {
    const pool = i % 4 === 3 ? TEMP_DIGITS : TEMP_LETTERS;
    chars.push(pool[randomInt(pool.length)]!);
  }
  // mezcla Fisher-Yates con el generador criptográfico
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

/** Intentos fallidos consecutivos que disparan cada tramo de bloqueo (persistente por usuario). */
export const LOCKOUT_STEPS: ReadonlyArray<{ failures: number; lockSeconds: number }> = [
  { failures: 5, lockSeconds: 5 * 60 },
  { failures: 8, lockSeconds: 30 * 60 },
  { failures: 12, lockSeconds: 4 * 60 * 60 },
];
/** Si pasó este tiempo sin fallos, el contador de fallos consecutivos vuelve a cero. */
export const FAILURE_FORGET_SECONDS = 24 * 60 * 60;

/** Bloqueo que corresponde tras `failures` fallos consecutivos (0 = ninguno). */
export function lockSecondsFor(failures: number): number {
  let secs = 0;
  for (const s of LOCKOUT_STEPS) if (failures >= s.failures) secs = s.lockSeconds;
  return secs;
}

export function isLocked(lockedUntil: string | Date | null | undefined, now: Date = new Date()): boolean {
  if (!lockedUntil) return false;
  return new Date(lockedUntil).getTime() > now.getTime();
}

/** Límites por ventana (persistentes en base, por IP y por usuario) del ingreso con contraseña. */
export const PASSWORD_LOGIN_LIMITS = {
  ip: { windowSeconds: 600, max: 30 },
  username: { windowSeconds: 900, max: 15 },
} as const;
