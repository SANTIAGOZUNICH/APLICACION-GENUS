/**
 * Plan de envío de un aviso a los dispositivos suscriptos. Función PURA respecto de la red: el «sender» (web-push) se inyecta
 * (en las pruebas apunta a un push service HTTPS local; nunca a un servicio real).
 *
 * Clasificación de la respuesta del servicio push (se guarda el motivo SIEMPRE; nada se traga):
 *  - 2xx                → ACEPTADO por el servicio push (esto NO prueba que el dispositivo lo haya mostrado: eso lo prueba el acuse del SW).
 *  - 404 / 410          → el dispositivo ya no existe: baja de la suscripción.
 *  - 401 / 403          → el servicio rechaza nuestra identificación VAPID (clave distinta a la usada al suscribir, o clave inválida): la
 *                          suscripción queda INVÁLIDA (el cliente tiene que volver a activar) y no se reintenta.
 *  - 413                → payload demasiado grande: error permanente de ese aviso.
 *  - 400 y otros 4xx    → error permanente de ese dispositivo (se reporta).
 *  - 429                → reintento respetando `Retry-After`.
 *  - 5xx / red / timeout → reintento con backoff.
 */
export type PushSubscriptionRow = { id: string; endpoint: string; p256dh: string; auth: string };
export type PushPayload = { title: string; body: string; url: string; tag: string; eventId: string; ack?: PushAck };
/** Credencial de acuse: el SW la devuelve al servidor al mostrar la notificación. No contiene datos del cliente. */
export type PushAck = { sid: string; token: string };
export type PushSendResponse = { status?: number } | void;
export type PushSender = (sub: PushSubscriptionRow, payload: string) => Promise<PushSendResponse>;

export type DeviceOutcomeKind = "accepted" | "gone" | "invalid" | "retry" | "permanent";
export type DeviceOutcome = { id: string; kind: DeviceOutcomeKind; status: number | null; error: string | null; retryAfterMs: number | null };

export type PushSendPlan = {
  outcomes: DeviceOutcome[];
  sent: string[];
  /** 404/410: el dispositivo ya no existe; se da de baja. */
  gone: string[];
  /** 401/403: suscripción rechazada por el servicio push (VAPID). */
  invalid: string[];
  /** Fallos (transitorios o permanentes) con su motivo. */
  failed: Array<{ id: string; error: string; permanent: boolean; retryAfterMs: number | null }>;
};

export function statusCodeOf(err: unknown): number | null {
  const c = (err as { statusCode?: unknown } | null)?.statusCode;
  return typeof c === "number" ? c : null;
}

/** `Retry-After` (segundos o fecha HTTP) → milisegundos; null si no viene o no se entiende. */
export function retryAfterMsOf(err: unknown, now = Date.now()): number | null {
  const h = (err as { headers?: Record<string, unknown> } | null)?.headers;
  const raw = h ? (h["retry-after"] ?? h["Retry-After"]) : null;
  if (raw == null) return null;
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) return Math.min(Number(s) * 1000, 6 * 3_600_000);
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.min(Math.max(0, t - now), 6 * 3_600_000) : null;
}

const describeError = (err: unknown, code: number | null): string => {
  const e = err as { body?: unknown; message?: unknown } | null;
  const detail = String(e?.body || e?.message || err).replace(/\s+/g, " ").slice(0, 160);
  return `${code ?? "ERR"}: ${detail}`;
};

/** Clasifica el error de UN dispositivo. */
export function classifyPushError(err: unknown): Omit<DeviceOutcome, "id"> {
  const code = statusCodeOf(err);
  const error = describeError(err, code);
  if (code === 404 || code === 410) return { kind: "gone", status: code, error: `${code}: dispositivo dado de baja por el servicio push`, retryAfterMs: null };
  if (code === 401 || code === 403) return { kind: "invalid", status: code, error: `${code}: VAPID rechazado por el servicio push (la suscripción no corresponde a la clave actual)`, retryAfterMs: null };
  if (code === 413) return { kind: "permanent", status: code, error: `413: payload demasiado grande`, retryAfterMs: null };
  if (code === 429) return { kind: "retry", status: code, error, retryAfterMs: retryAfterMsOf(err) };
  if (code != null && code >= 400 && code < 500 && code !== 408) return { kind: "permanent", status: code, error, retryAfterMs: null };
  return { kind: "retry", status: code, error, retryAfterMs: retryAfterMsOf(err) };
}

export function serializePayload(p: PushPayload): string {
  return JSON.stringify({ title: p.title, body: p.body, url: p.url, tag: p.tag, eventId: p.eventId, ...(p.ack ? { ack: p.ack } : {}) });
}

/** Envía a cada dispositivo y clasifica el resultado. Un fallo de un dispositivo nunca frena a los demás ni lanza. `payload` puede ser por dispositivo (acuse). */
export async function planPushSend(subs: ReadonlyArray<PushSubscriptionRow>, payload: PushPayload | ((sub: PushSubscriptionRow) => PushPayload), sender: PushSender): Promise<PushSendPlan> {
  const plan: PushSendPlan = { outcomes: [], sent: [], gone: [], invalid: [], failed: [] };
  for (const s of subs) {
    try {
      const body = serializePayload(typeof payload === "function" ? payload(s) : payload);
      const res = await sender(s, body);
      const status = res && typeof res === "object" && typeof res.status === "number" ? res.status : 201;
      plan.sent.push(s.id);
      plan.outcomes.push({ id: s.id, kind: "accepted", status, error: null, retryAfterMs: null });
    } catch (err) {
      const o = classifyPushError(err);
      plan.outcomes.push({ id: s.id, ...o });
      if (o.kind === "gone") plan.gone.push(s.id);
      else if (o.kind === "invalid") plan.invalid.push(s.id);
      else plan.failed.push({ id: s.id, error: o.error ?? "error", permanent: o.kind === "permanent", retryAfterMs: o.retryAfterMs });
    }
  }
  return plan;
}
