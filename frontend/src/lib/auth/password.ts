import "server-only";

import bcrypt from "bcryptjs";
import { PASSWORD_HASH_COST } from "@/lib/auth/constants";

/**
 * Hashea una contraseña con bcrypt (cost 12). El resultado es seguro de
 * persistir; el valor de entrada NUNCA debe loguearse ni incluirse en
 * eventos de auditoría.
 */
export async function hashPassword(plainPassword: string): Promise<string> {
  if (!plainPassword || typeof plainPassword !== "string") {
    throw new Error("Password inválida.");
  }
  return bcrypt.hash(plainPassword, PASSWORD_HASH_COST);
}

/**
 * Compara una contraseña en texto plano contra un hash bcrypt persistido.
 * Nunca lanza por mismatch: devuelve false. Nunca loguea ninguno de los
 * dos argumentos.
 */
export async function verifyPassword(
  plainPassword: string,
  passwordHash: string
): Promise<boolean> {
  if (!plainPassword || !passwordHash) return false;
  try {
    return await bcrypt.compare(plainPassword, passwordHash);
  } catch {
    return false;
  }
}
