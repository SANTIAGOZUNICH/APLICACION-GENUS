import "server-only";

/**
 * OAuth 2.0 de Gmail (solo lectura) para la casilla de pedidos. Reutiliza el paquete `googleapis` ya instalado; NO reutiliza la cuenta de
 * servicio de Drive (esa no puede leer un buzón sin delegación de dominio y no queremos ampliar permisos).
 *
 * Variables (todas del servidor): GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REDIRECT_URI (opcional: si falta se usa
 * el origen de la petición), GMAIL_CONNECT_ACCOUNT (cuenta de Gmail a conectar; default agzunich@gmail.com) y GMAIL_ORDERS_ADDRESS (destinatario ORIGINAL que se procesa; default pedidos@laboratoriogenus.com.ar), EMAIL_TOKEN_ENCRYPTION_KEY.
 */
import { google } from "googleapis";
import { diagnoseKey } from "./crypto";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
/** Casilla de pedidos de la empresa (Webnode): es el destinatario ORIGINAL de los correos que se procesan. */
export const DEFAULT_ORDERS_ADDRESS = "pedidos@laboratoriogenus.com.ar";
/** Cuenta de Gmail a la que Webnode reenvía: es la ÚNICA que se puede conectar por OAuth. */
export const DEFAULT_CONNECT_ACCOUNT = "agzunich@gmail.com";

export const connectAccount = (env: Partial<NodeJS.ProcessEnv> = process.env) => (env.GMAIL_CONNECT_ACCOUNT?.trim() || DEFAULT_CONNECT_ACCOUNT).toLowerCase();
export const ordersAddress = (env: Partial<NodeJS.ProcessEnv> = process.env) => (env.GMAIL_ORDERS_ADDRESS?.trim() || DEFAULT_ORDERS_ADDRESS).toLowerCase();

export type ConfigIssue = { name: string; problem: "ausente" | "vacía_o_con_espacios" | "demasiado_corta" };
export type OAuthConfigStatus = {
  ready: boolean;
  /** Variables que NO llegaron al servidor (no definidas, o definidas en otro entorno / sin redeploy posterior). */
  missing: string[];
  /** Variables presentes pero inutilizables (formato). Nunca incluye el valor. */
  invalid: ConfigIssue[];
  /** Cómo se interpretó la clave de cifrado (sin el valor): null si no se pudo. */
  keyFormat: "base64" | "hex" | "derivada" | null;
};
export function oauthConfigStatus(env: Partial<NodeJS.ProcessEnv> = process.env): OAuthConfigStatus {
  const missing: string[] = [];
  const invalid: ConfigIssue[] = [];
  for (const name of ["GMAIL_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_SECRET"] as const) {
    const raw = env[name];
    if (raw === undefined) missing.push(name);
    else if (!raw.trim()) invalid.push({ name, problem: "vacía_o_con_espacios" });
  }
  const k = diagnoseKey(env.EMAIL_TOKEN_ENCRYPTION_KEY);
  if (!k.ok) {
    if (env.EMAIL_TOKEN_ENCRYPTION_KEY === undefined) missing.push("EMAIL_TOKEN_ENCRYPTION_KEY");
    else invalid.push({ name: "EMAIL_TOKEN_ENCRYPTION_KEY", problem: k.reason === "ausente" ? "vacía_o_con_espacios" : "demasiado_corta" });
  }
  return { ready: missing.length === 0 && invalid.length === 0, missing, invalid, keyFormat: k.ok ? k.format : null };
}

/** Texto para la persona (sin valores): qué falta y qué está mal escrito. */
export function describeConfigProblems(c: OAuthConfigStatus): string {
  const parts: string[] = [];
  if (c.missing.length) parts.push(`no llegan al servidor: ${c.missing.join(", ")} (revisá que estén en el entorno Production y hacer un redeploy DESPUÉS de crearlas)`);
  for (const i of c.invalid) {
    parts.push(`${i.name} ${i.problem === "demasiado_corta" ? "es demasiado corta (mínimo 32 caracteres; usá `openssl rand -base64 32`)" : "está vacía"}`);
  }
  return parts.join("; ");
}

export function redirectUri(requestUrl: string, env: Partial<NodeJS.ProcessEnv> = process.env): string {
  return env.GMAIL_OAUTH_REDIRECT_URI?.trim() || `${new URL(requestUrl).origin}/api/v1/email-orders/oauth/callback`;
}

export function oauthClient(requestUrl: string, env: Partial<NodeJS.ProcessEnv> = process.env) {
  return new google.auth.OAuth2(env.GMAIL_OAUTH_CLIENT_ID!.trim(), env.GMAIL_OAUTH_CLIENT_SECRET!.trim(), redirectUri(requestUrl, env));
}

/** URL de consentimiento: permiso MÍNIMO (gmail.readonly), acceso offline para el refresh token y `login_hint` de la casilla autorizada. */
export function buildAuthUrl(requestUrl: string, state: string, env: Partial<NodeJS.ProcessEnv> = process.env): string {
  return oauthClient(requestUrl, env).generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [GMAIL_READONLY_SCOPE],
    include_granted_scopes: false,
    login_hint: connectAccount(env),
    state,
  });
}

/** Cliente de Gmail autenticado con el refresh token (se renueva solo el access token en memoria; nunca se persiste). */
export function gmailWithRefreshToken(refreshToken: string, env: Partial<NodeJS.ProcessEnv> = process.env) {
  const auth = new google.auth.OAuth2(env.GMAIL_OAUTH_CLIENT_ID!.trim(), env.GMAIL_OAUTH_CLIENT_SECRET!.trim());
  auth.setCredentials({ refresh_token: refreshToken });
  return { auth, gmail: google.gmail({ version: "v1", auth }) };
}

export async function revokeToken(token: string): Promise<void> {
  try {
    await new google.auth.OAuth2().revokeToken(token);
  } catch {
    /* si ya estaba revocado no importa: igual se borra de la base */
  }
}
