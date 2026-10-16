import { PORTAL_BASE_PATH, PORTAL_COOKIE_NAME, PORTAL_SESSION_TTL_SECONDS } from "./config";

const secure = () => process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL || process.env.VERCEL_ENV);

/**
 * Cookie de sesión del portal: HttpOnly, SameSite=Lax, Secure en producción, SOLO para /entregas y sin Domain (queda atada
 * al host que ve el navegador). Es independiente de la cookie interna `genus_session`.
 */
export function buildPortalCookie(token: string, maxAgeSeconds = PORTAL_SESSION_TTL_SECONDS): string {
  return [`${PORTAL_COOKIE_NAME}=${token}`, `Path=${PORTAL_BASE_PATH}`, `Max-Age=${maxAgeSeconds}`, "HttpOnly", "SameSite=Lax", ...(secure() ? ["Secure"] : [])].join("; ");
}

export function clearPortalCookie(): string {
  return buildPortalCookie("", 0);
}

export function parsePortalCookie(header: string | null | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === PORTAL_COOKIE_NAME) {
      const v = rest.join("=").trim();
      return v.length >= 20 && v.length <= 200 && /^[A-Za-z0-9_-]+$/.test(v) ? v : null;
    }
  }
  return null;
}

export const DEMO_COOKIE_NAME = "genus_portal_demo";
export const DEMO_SESSION_TTL_SECONDS = 60 * 60;

/** Cookie de la sesión DEMO: separada de la de clientes reales, mismas protecciones y solo para /entregas. */
export function buildDemoCookie(token: string, maxAgeSeconds = DEMO_SESSION_TTL_SECONDS): string {
  return [`${DEMO_COOKIE_NAME}=${token}`, `Path=${PORTAL_BASE_PATH}`, `Max-Age=${maxAgeSeconds}`, "HttpOnly", "SameSite=Lax", ...(secure() ? ["Secure"] : [])].join("; ");
}

export function clearDemoCookie(): string {
  return buildDemoCookie("", 0);
}

export function parseDemoCookie(header: string | null | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === DEMO_COOKIE_NAME) {
      const v = rest.join("=").trim();
      return v.length >= 20 && v.length <= 200 && /^[A-Za-z0-9_-]+$/.test(v) ? v : null;
    }
  }
  return null;
}
