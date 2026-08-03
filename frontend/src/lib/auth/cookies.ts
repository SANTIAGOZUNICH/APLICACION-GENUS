import "server-only";

import { COOKIE_NAME, SESSION_TTL_SECONDS } from "@/lib/auth/constants";

export { COOKIE_NAME };

/** Secure cuando corre en Vercel (Preview/Production) o NODE_ENV=production. */
function isSecureContext(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.VERCEL) ||
    process.env.VERCEL_ENV === "preview" ||
    process.env.VERCEL_ENV === "production"
  );
}

/**
 * Header `Set-Cookie` para iniciar sesión. HttpOnly siempre; Secure cuando
 * corre en Vercel o NODE_ENV=production; SameSite=Lax; Path=/.
 */
export function buildSetCookieHeader(
  token: string,
  options?: { maxAgeSeconds?: number }
): string {
  const maxAge = options?.maxAgeSeconds ?? SESSION_TTL_SECONDS;
  const parts = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isSecureContext()) parts.push("Secure");
  return parts.join("; ");
}

/** Header `Set-Cookie` para cerrar sesión (expira inmediatamente). */
export function clearCookieHeader(): string {
  const parts = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isSecureContext()) parts.push("Secure");
  return parts.join("; ");
}

/** Extrae el valor de la cookie de sesión de un header `Cookie` (o null). */
export function parseSessionCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === COOKIE_NAME) {
      const value = rest.join("=").trim();
      return value || null;
    }
  }
  return null;
}
