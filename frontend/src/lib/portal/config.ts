/** Configuración del Portal de Clientes (todo por variables de entorno, con valores seguros por defecto). */

export const PORTAL_BASE_PATH = "/entregas";
export const PORTAL_COOKIE_NAME = "genus_portal_session";
export const PORTAL_SESSION_TTL_SECONDS = 12 * 60 * 60;
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;

/** Datos de contacto reales del laboratorio (los de la web institucional). Se pueden cambiar por variables de entorno. */
export function portalContact() {
  const whatsapp = process.env.PORTAL_CONTACT_WHATSAPP?.trim() || "5491124980861";
  return {
    email: process.env.PORTAL_CONTACT_EMAIL?.trim() || "ventas@laboratoriogenus.com.ar",
    whatsappDigits: whatsapp,
    whatsappLabel: process.env.PORTAL_CONTACT_WHATSAPP_LABEL?.trim() || "+54 9 11 2498-0861",
    whatsappUrl: `https://wa.me/${whatsapp}`,
  };
}

/** URL pública del portal (sin barra final). Los enlaces de los correos salen de acá, nunca del host de la solicitud. */
export function portalPublicBaseUrl(): string {
  const raw = process.env.PORTAL_PUBLIC_BASE_URL?.trim() || "https://www.laboratoriogenus.com.ar/entregas";
  return raw.replace(/\/+$/, "");
}

/**
 * Modo de correo:
 *  - off (por defecto): no se envía nada; cada correo queda registrado como «sin proveedor».
 *  - live: se envía de verdad (requiere proveedor configurado).
 *  - capture: SOLO pruebas locales: guarda el correo completo en la base y no lo envía (nunca en Vercel).
 */
export type EmailMode = "off" | "live" | "capture";
export function emailMode(): EmailMode {
  const v = (process.env.PORTAL_EMAIL_MODE ?? "off").trim().toLowerCase();
  if (v === "live") return "live";
  if (v === "capture" && process.env.VERCEL !== "1") return "capture";
  return "off";
}

export function emailProviderConfig(): { provider: "resend"; apiKey: string; from: string } | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.PORTAL_EMAIL_FROM?.trim();
  if (!apiKey || !from) return null;
  return { provider: "resend", apiKey, from };
}

/** Los correos en cola más viejos que esto no se envían al configurar el proveedor (serían avisos vencidos). */
export const EMAIL_MAX_AGE_HOURS = 48;
