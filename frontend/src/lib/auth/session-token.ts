import "server-only";

import { createHash, randomBytes } from "node:crypto";

/**
 * Genera un token de sesión opaco (256 bits) en base64url. Este es el único
 * valor que viaja en la cookie del cliente; nunca se persiste en claro.
 */
export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * sha256(token) en hex — lo único que se persiste en `genus_auth_sessions`.
 * Determinístico: permite buscar la sesión por token sin guardar el token
 * en claro en ningún lado (DB, logs, memoria persistente).
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
