/**
 * Primitivas de seguridad del Portal de Clientes (sin base de datos). Independientes de la autenticación interna de
 * GENUS OS: el portal tiene su propia cookie, sus propias tablas y sus propios códigos.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** Sin 0/O/1/I/L para que nadie confunda el código al dictarlo. */
export const PUBLIC_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const PUBLIC_CODE_PREFIX = "GEN";
export const PUBLIC_CODE_LENGTH = 6;

/** Código público único del cliente («GEN-7K4M9Q»). Por sí solo NO da acceso: siempre hace falta un correo autorizado. */
export function generatePublicCode(): string {
  let body = "";
  for (let i = 0; i < PUBLIC_CODE_LENGTH; i++) body += PUBLIC_CODE_ALPHABET[randomInt(PUBLIC_CODE_ALPHABET.length)];
  return `${PUBLIC_CODE_PREFIX}-${body}`;
}

/** Acepta «gen-7k4m9q», «GEN 7K4M9Q», «7K4M9Q»… y devuelve el formato canónico, o null si no es un código válido. */
export function normalizePublicCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let t = input.toUpperCase().replace(/[\s_-]+/g, "");
  if (t.startsWith(PUBLIC_CODE_PREFIX)) t = t.slice(PUBLIC_CODE_PREFIX.length);
  if (t.length !== PUBLIC_CODE_LENGTH) return null;
  for (const ch of t) if (!PUBLIC_CODE_ALPHABET.includes(ch)) return null;
  return `${PUBLIC_CODE_PREFIX}-${t}`;
}

export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const t = input.trim().toLowerCase();
  if (t.length < 5 || t.length > 254) return null;
  if (!/^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/.test(t)) return null;
  return t;
}

/** Código numérico de un solo uso (6 dígitos). */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export const normalizeOtp = (input: unknown): string | null => {
  if (typeof input !== "string") return null;
  const t = input.replace(/\s|-/g, "");
  return /^\d{6}$/.test(t) ? t : null;
};

/** Token opaco (enlace seguro y sesión): 256 bits. Solo se guarda su hash. */
export function createToken(): string {
  return randomBytes(32).toString("base64url");
}

export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/**
 * Clave del servidor para firmar los hashes del portal. Un código de 6 dígitos sin clave se rompería en milisegundos si
 * se filtrara la base: con HMAC hace falta además la clave (que NO está en la base). `PORTAL_AUTH_SECRET` si existe; si no
 * se deriva de la conexión a la base (secreto solo del servidor), así nunca hay un valor fijo público.
 */
export function portalSecret(): string {
  const explicit = process.env.PORTAL_AUTH_SECRET?.trim();
  if (explicit && explicit.length >= 16) return explicit;
  const db = process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim() || "";
  if (db) return sha256(`genus-portal-secret|${db}`);
  if (process.env.NODE_ENV === "test") return "test-only-portal-secret-0123456789";
  throw new Error("Falta PORTAL_AUTH_SECRET (o una conexión a la base) para firmar los códigos del portal.");
}

export const hmac = (label: string, value: string) => createHmac("sha256", portalSecret()).update(`${label}|${value}`).digest("hex");

export function constantTimeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** IP del cliente (primer salto de x-forwarded-for) → hash. Nunca se guarda la IP en claro. */
export function clientIpHash(headers: Headers): string {
  const ip = (headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "unknown";
  return hmac("ip", ip).slice(0, 32);
}

/**
 * Protección CSRF de los POST del portal: el navegador manda `Origin`; tiene que ser el propio sitio. El portal se sirve
 * desde dos hosts (el dominio público y el de la aplicación), así que se acepta el host público (x-forwarded-host o
 * PORTAL_PUBLIC_BASE_URL) y el host real de la solicitud. Sin `Origin` (clientes no navegador) se rechaza.
 */
export function isAllowedOrigin(headers: Headers, requestUrl: string): boolean {
  const origin = headers.get("origin");
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const allowed = new Set<string>();
  const forwarded = headers.get("x-forwarded-host")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded) allowed.add(forwarded);
  const host = headers.get("host")?.toLowerCase();
  if (host) allowed.add(host);
  try {
    allowed.add(new URL(requestUrl).host.toLowerCase());
  } catch {
    /* ignore */
  }
  // Host público del portal (por defecto el dominio institucional, www y sin www) detrás del rewrite.
  for (const base of [process.env.PORTAL_PUBLIC_BASE_URL?.trim() || "https://www.laboratoriogenus.com.ar/entregas", "https://laboratoriogenus.com.ar"]) {
    try {
      allowed.add(new URL(base).host.toLowerCase());
    } catch {
      /* ignore */
    }
  }
  return allowed.has(originHost);
}
