/**
 * Plan de envío de un aviso a los dispositivos suscriptos. Función PURA respecto de la red: el «sender» (web-push) se inyecta,
 * así se prueba con un mock y nunca se llama a un servicio real en las pruebas.
 */
export type PushSubscriptionRow = { id: string; endpoint: string; p256dh: string; auth: string };
export type PushPayload = { title: string; body: string; url: string; tag: string; eventId: string };
export type PushSender = (sub: PushSubscriptionRow, payload: string) => Promise<void>;
export type PushSendPlan = {
  sent: string[];
  /** 404/410: el dispositivo ya no existe; se da de baja. */
  gone: string[];
  failed: Array<{ id: string; error: string }>;
};

export function statusCodeOf(err: unknown): number | null {
  const c = (err as { statusCode?: unknown } | null)?.statusCode;
  return typeof c === "number" ? c : null;
}

export function serializePayload(p: PushPayload): string {
  return JSON.stringify({ title: p.title, body: p.body, url: p.url, tag: p.tag, eventId: p.eventId });
}

/** Envía a cada dispositivo y clasifica el resultado. Un fallo de un dispositivo nunca frena a los demás ni lanza. */
export async function planPushSend(subs: ReadonlyArray<PushSubscriptionRow>, payload: PushPayload, sender: PushSender): Promise<PushSendPlan> {
  const plan: PushSendPlan = { sent: [], gone: [], failed: [] };
  const body = serializePayload(payload);
  for (const s of subs) {
    try {
      await sender(s, body);
      plan.sent.push(s.id);
    } catch (err) {
      const code = statusCodeOf(err);
      if (code === 404 || code === 410) plan.gone.push(s.id);
      else plan.failed.push({ id: s.id, error: `${code ?? "ERR"}: ${String((err as Error)?.message ?? err).slice(0, 200)}` });
    }
  }
  return plan;
}
