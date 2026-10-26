/**
 * Cifrado del refresh token de Gmail (AES-256-GCM). La clave vive SOLO en el servidor (`EMAIL_TOKEN_ENCRYPTION_KEY`, 32 bytes en base64).
 * Formato: `v1.<iv>.<tag>.<ciphertext>` (base64url). Sin clave válida NO se guarda ningún token.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export class TokenCryptoError extends Error {}

/**
 * Interpreta la clave configurada. Acepta los formatos que se usan en la práctica y NUNCA devuelve ni registra el valor:
 *  1) 32 bytes en base64 / base64url (`openssl rand -base64 32`, formato documentado);
 *  2) 32 bytes en hexadecimal (64 caracteres, `openssl rand -hex 32`);
 *  3) cualquier otro secreto de ≥ 32 caracteres: se deriva una clave de 32 bytes con SHA-256 (determinístico: el mismo texto da la misma clave).
 * Comillas o espacios/saltos de línea sobrantes (típico al pegar en Vercel) se quitan. Más corto que 32 caracteres → inválida.
 */
export type KeyDiagnosis = { ok: true; format: "base64" | "hex" | "derivada"; key: Buffer } | { ok: false; reason: "ausente" | "demasiado_corta"; length: number };

export function diagnoseKey(raw: string | undefined): KeyDiagnosis {
  const v = (raw ?? "").trim().replace(/^(["'])([\s\S]*)\1$/, "$2").trim();
  if (!v) return { ok: false, reason: "ausente", length: 0 };
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(v)) {
    const b = Buffer.from(v.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (b.length === 32) return { ok: true, format: "base64", key: b };
  }
  if (/^[0-9a-fA-F]{64}$/.test(v)) return { ok: true, format: "hex", key: Buffer.from(v, "hex") };
  if (v.length >= 32) return { ok: true, format: "derivada", key: createHash("sha256").update(v, "utf8").digest() };
  return { ok: false, reason: "demasiado_corta", length: v.length };
}

function keyFrom(raw: string | undefined): Buffer {
  const d = diagnoseKey(raw);
  if (!d.ok) {
    throw new TokenCryptoError(
      d.reason === "ausente" ? "Falta EMAIL_TOKEN_ENCRYPTION_KEY." : `EMAIL_TOKEN_ENCRYPTION_KEY es demasiado corta (${d.length} caracteres; mínimo 32). Generá una con: openssl rand -base64 32`
    );
  }
  return d.key;
}

export function encryptionKeyConfigured(env: Partial<NodeJS.ProcessEnv> = process.env): boolean {
  return diagnoseKey(env.EMAIL_TOKEN_ENCRYPTION_KEY).ok;
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
