/**
 * Cifrado del refresh token de Gmail (AES-256-GCM). La clave vive SOLO en el servidor (`EMAIL_TOKEN_ENCRYPTION_KEY`, 32 bytes en base64).
 * Formato: `v1.<iv>.<tag>.<ciphertext>` (base64url). Sin clave válida NO se guarda ningún token.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class TokenCryptoError extends Error {}

function keyFrom(raw: string | undefined): Buffer {
  const b = Buffer.from((raw ?? "").trim(), "base64");
  if (b.length !== 32) throw new TokenCryptoError("Falta EMAIL_TOKEN_ENCRYPTION_KEY (32 bytes en base64).");
  return b;
}

export function encryptionKeyConfigured(env: Partial<NodeJS.ProcessEnv> = process.env): boolean {
  try {
    keyFrom(env.EMAIL_TOKEN_ENCRYPTION_KEY);
    return true;
  } catch {
    return false;
  }
}

export function encryptToken(plain: string, env: Partial<NodeJS.ProcessEnv> = process.env): string {
  const key = keyFrom(env.EMAIL_TOKEN_ENCRYPTION_KEY);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptToken(stored: string, env: Partial<NodeJS.ProcessEnv> = process.env): string {
  const key = keyFrom(env.EMAIL_TOKEN_ENCRYPTION_KEY);
  const [v, iv, tag, data] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new TokenCryptoError("Token guardado con formato desconocido.");
  try {
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
  } catch {
    throw new TokenCryptoError("No se pudo descifrar el token (¿cambió EMAIL_TOKEN_ENCRYPTION_KEY?). Reconectá la cuenta.");
  }
}

/** Estado firmado del flujo OAuth (anti-CSRF): `<payload>.<hmac>`; vence a los 10 minutos. */
import { createHmac, timingSafeEqual } from "node:crypto";
export function signState(payload: { email: string; nonce: string; ts: number }, env: Partial<NodeJS.ProcessEnv> = process.env): string {
  const key = keyFrom(env.EMAIL_TOKEN_ENCRYPTION_KEY);
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}
export function verifyState(state: string, env: Partial<NodeJS.ProcessEnv> = process.env, now = Date.now()): { email: string; nonce: string; ts: number } | null {
  try {
    const key = keyFrom(env.EMAIL_TOKEN_ENCRYPTION_KEY);
    const [body, mac] = state.split(".");
    if (!body || !mac) return null;
    const expect = createHmac("sha256", key).update(body).digest();
    const got = Buffer.from(mac, "base64url");
    if (got.length !== expect.length || !timingSafeEqual(got, expect)) return null;
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { email: string; nonce: string; ts: number };
    if (!p || typeof p.ts !== "number" || now - p.ts > 10 * 60_000 || now < p.ts - 60_000) return null;
    return p;
  } catch {
    return null;
  }
}
