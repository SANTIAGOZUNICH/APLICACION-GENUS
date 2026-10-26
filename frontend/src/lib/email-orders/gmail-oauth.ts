import "server-only";

/**
 * OAuth 2.0 de Gmail (solo lectura) para la casilla de pedidos. Reutiliza el paquete `googleapis` ya instalado; NO reutiliza la cuenta de
 * servicio de Drive (esa no puede leer un buzón sin delegación de dominio y no queremos ampliar permisos).
 *
 * Variables (todas del servidor): GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REDIRECT_URI (opcional: si falta se usa
 * el origen de la petición), GMAIL_ORDERS_ACCOUNT (default pedidos@laboratoriogenus.com.ar), EMAIL_TOKEN_ENCRYPTION_KEY.
 */
import { google } from "googleapis";
import { encryptionKeyConfigured } from "./crypto";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const DEFAULT_ORDERS_ACCOUNT = "pedidos@laboratoriogenus.com.ar";

export const ordersAccount = (env: Partial<NodeJS.ProcessEnv> = process.env) => (env.GMAIL_ORDERS_ACCOUNT?.trim() || DEFAULT_ORDERS_ACCOUNT).toLowerCase();

export type OAuthConfigStatus = { ready: boolean; missing: string[] };
export function oauthConfigStatus(env: Partial<NodeJS.ProcessEnv> = process.env): OAuthConfigStatus {
  const missing: string[] = [];
  if (!env.GMAIL_OAUTH_CLIENT_ID?.trim()) missing.push("GMAIL_OAUTH_CLIENT_ID");
  if (!env.GMAIL_OAUTH_CLIENT_SECRET?.trim()) missing.push("GMAIL_OAUTH_CLIENT_SECRET");
  if (!encryptionKeyConfigured(env)) missing.push("EMAIL_TOKEN_ENCRYPTION_KEY");
  return { ready: missing.length === 0, missing };
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
    login_hint: ordersAccount(env),
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
