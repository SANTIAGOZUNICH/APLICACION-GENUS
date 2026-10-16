import "server-only";

import { emailMode, emailProviderConfig, type EmailMode } from "./config";

export type OutgoingEmail = { to: string; subject: string; text: string; html: string };
export type DeliveryResult =
  | { status: "ENVIADO"; provider: string; providerMessageId: string | null }
  | { status: "SIN_PROVEEDOR"; provider: null; error: string }
  | { status: "CAPTURADO"; provider: null }
  | { status: "ERROR"; provider: string; error: string };

let transportOverride: ((msg: OutgoingEmail) => Promise<DeliveryResult>) | null = null;
/** Pruebas: reemplaza el envío (nunca se envían correos reales desde los tests). */
export function setEmailTransportForTests(fn: typeof transportOverride) {
  transportOverride = fn;
}

/**
 * Entrega un correo según el modo (ver config.ts). En modo «off» o sin proveedor NO envía: lo informa para que quede
 * registrado como «sin proveedor». Nunca lanza.
 */
export async function deliverEmail(msg: OutgoingEmail, mode: EmailMode = emailMode()): Promise<DeliveryResult> {
  if (transportOverride) return transportOverride(msg);
  if (mode === "capture") return { status: "CAPTURADO", provider: null };
  if (mode !== "live") return { status: "SIN_PROVEEDOR", provider: null, error: "Correo desactivado (PORTAL_EMAIL_MODE no es «live»)." };
  const cfg = emailProviderConfig();
  if (!cfg) return { status: "SIN_PROVEEDOR", provider: null, error: "Falta configurar el proveedor de correo (RESEND_API_KEY y PORTAL_EMAIL_FROM)." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: cfg.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { status: "ERROR", provider: cfg.provider, error: `El proveedor rechazó el envío (${res.status}): ${body.message ?? "sin detalle"}` };
    return { status: "ENVIADO", provider: cfg.provider, providerMessageId: body.id ?? null };
  } catch (err) {
    return { status: "ERROR", provider: cfg.provider, error: err instanceof Error ? err.message : "No se pudo contactar al proveedor de correo." };
  }
}
