/**
 * Verificación del DESTINATARIO ORIGINAL de un correo que llega reenviado (Webnode → Gmail). Reglas PURAS sobre los ENCABEZADOS (nunca el
 * asunto ni el cuerpo, que escribe cualquiera). Si no hay evidencia verificable, el correo se EXCLUYE: no se descargan adjuntos ni se envía a la IA.
 *
 * Evidencia (de más a menos fuerte):
 *  - «fuerte»: encabezados que agregan los servidores de correo con el destinatario real: X-Original-To, X-Envelope-To / Envelope-To,
 *    Original-Recipient / X-Original-Recipient, X-Forwarded-For (origen→destino) o un Delivered-To de una etapa anterior al buzón de Gmail.
 *  - «declarada»: la dirección figura como destinatario en To / Cc / Resent-To, o en la cláusula `for <dirección>` de un Received.
 * Las direcciones se comparan EXACTAS (sin nombres para mostrar, sin dominios parecidos como `…com.ar.evil.com` ni `xpedidos@…`).
 */
export type Header = { name: string; value: string };
export type Strength = "fuerte" | "declarada";
export type RecipientVerdict =
  | { verified: true; strength: Strength; evidence: string[] }
  | { verified: false; reason: "sin_encabezados" | "sin_destinatario_original"; evidence: string[] };

const STRONG = ["x-original-to", "x-envelope-to", "envelope-to", "original-recipient", "x-original-recipient", "x-forwarded-for", "x-rcpt-to"];
const DECLARED = ["to", "cc", "resent-to"];

/** Direcciones de un valor de encabezado: se quitan nombres entre comillas y comentarios (los controla el remitente) y se compara token a token. */
export function addressesOf(value: string): string[] {
  const clean = value.replace(/"(?:[^"\\]|\\.)*"/g, " ").replace(/\((?:[^()\\]|\\.)*\)/g, " ");
  return clean
    .split(/[\s,;<>]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t));
}

/** Direcciones de la cláusula `for <x>` de un Received (la agrega el servidor que recibió el mensaje). */
function receivedFor(value: string): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(/\bfor\s+<?([^\s;<>]+)>?\s*(?:;|$)/gi)) out.push(m[1]!.toLowerCase());
  return out;
}

export function verifyOriginalRecipient(headers: readonly Header[], target: string, ownMailbox = ""): RecipientVerdict {
  if (!headers.length) return { verified: false, reason: "sin_encabezados", evidence: [] };
  const want = target.trim().toLowerCase();
  const own = ownMailbox.trim().toLowerCase();
  const strong: string[] = [];
  const declared: string[] = [];
  for (const h of headers) {
    const name = h.name.toLowerCase();
    const addrs = addressesOf(h.value ?? "");
    if (STRONG.includes(name) && addrs.includes(want)) strong.push(h.name);
    else if (name === "delivered-to" && addrs.includes(want) && want !== own) strong.push(h.name);
    else if (DECLARED.includes(name) && addrs.includes(want)) declared.push(h.name);
    else if (name === "received" && receivedFor(h.value ?? "").includes(want)) declared.push("Received(for)");
  }
  if (strong.length) return { verified: true, strength: "fuerte", evidence: [...new Set(strong)] };
  if (declared.length) return { verified: true, strength: "declarada", evidence: [...new Set(declared)] };
  return { verified: false, reason: "sin_destinatario_original", evidence: [] };
}

/** Solo el dominio del remitente (para listar exclusiones sin exponer correos personales). */
export function senderDomain(from: string): string {
  const a = addressesOf(from)[0] ?? "";
  return a.split("@")[1] ?? "";
}

/** Encabezados que se piden a Gmail (solo metadatos: sin asunto, cuerpo ni adjuntos). */
export const VERIFICATION_HEADERS = ["To", "Cc", "Resent-To", "Delivered-To", "X-Original-To", "X-Envelope-To", "Envelope-To", "Original-Recipient", "X-Original-Recipient", "X-Forwarded-For", "X-Forwarded-To", "X-Rcpt-To", "Received", "From", "Date"] as const;
