/**
 * Notificaciones Web Push del Portal de Clientes — reglas PURAS (sin E/S).
 *
 * Qué avisa: cuando el estado COMERCIAL del pedido (deriveClientOrderStatus) avanza a Recibido, Elaboración, Envasado, Listo o
 * Entregado. Se compara contra el último estado ya notificado por pedido (portal_push_order_state):
 *  - Un estado que retrocede (reproceso, corrección) o se repite NO envía nada y NO baja el estado notificado.
 *  - Sin retroactivos: al habilitar el piloto de un cliente se hace un «baseline» (estado actual = ya notificado, sin envío).
 *  - Un pedido nuevo que aparece ya en «Listo»/«Entregado» (nunca lo vimos antes) se registra en silencio: sería un aviso vencido.
 *  - «Listo» y «Entregado» solo si el pedido está completo (`todoListo`): nunca con productos pendientes.
 *  - Un pedido que salta etapas (p. ej. Recibido → Envasado entre dos corridas) avisa solo la etapa actual.
 */

export const PUSH_EVENT_TYPES = ["RECIBIDO", "ELABORACION", "ENVASADO", "LISTO", "ENTREGADO"] as const;
export type PushEventType = (typeof PUSH_EVENT_TYPES)[number];

/** Estado comercial → rango de aviso. «Pedido programado» (2) sigue siendo «Recibido» para el cliente. */
export function pushRankOfStatus(statusId: number): number {
  if (statusId === 2) return 1;
  return statusId >= 1 && statusId <= 6 ? statusId : 0;
}

const TYPE_BY_RANK: Record<number, PushEventType> = { 1: "RECIBIDO", 3: "ELABORACION", 4: "ENVASADO", 5: "LISTO", 6: "ENTREGADO" };
export const pushTypeOfRank = (rank: number): PushEventType | null => TYPE_BY_RANK[rank] ?? null;

export const DEFAULT_ELABORACION_DAYS = 8;
export const DEFAULT_ENVASADO_DAYS = 3;
export type PushDays = { elaboracionDays: number; envasadoDays: number };

/** «1 día hábil» / «8 días hábiles». */
export function businessDaysLabel(n: number): string {
  return n === 1 ? "1 día hábil" : `${n} días hábiles`;
}

export type PushMessage = { title: string; body: string };

/** Textos EXACTOS definidos por Laboratorio Genus. Los plazos son estimaciones configurables por Dirección. */
export function buildPushMessage(type: PushEventType, orderRef: string | null, days: PushDays): PushMessage {
  const base = ((): PushMessage => {
    switch (type) {
      case "RECIBIDO":
        return { title: "¡Recibimos tu pedido!", body: "Tu pedido fue registrado correctamente. Te mantendremos informado sobre su avance." };
      case "ELABORACION":
        return {
          title: "¡Tu pedido se está elaborando!",
          body: `Comenzamos la elaboración de tus productos. Estimamos que estarán listos para entregar en aproximadamente ${businessDaysLabel(days.elaboracionDays)}.`,
        };
      case "ENVASADO":
        return {
          title: "¡Tu pedido está en envasado!",
          body: `Estamos en la etapa final de producción. Estimamos que tu pedido estará listo para entregar en aproximadamente ${businessDaysLabel(days.envasadoDays)}.`,
        };
      case "LISTO":
        return { title: "¡TU PEDIDO ESTÁ LISTO! 🎉", body: "Finalizamos la producción de tu pedido. Ya está disponible para coordinar su entrega. ¡Gracias por confiar en nosotros!" };
      case "ENTREGADO":
        return { title: "¡Pedido entregado!", body: "Tu pedido fue entregado. Gracias por elegir Laboratorio Genus." };
    }
  })();
  const ref = orderRef?.trim();
  // La identificación del pedido va en una línea aparte para no alterar el texto definido.
  return ref ? { title: base.title, body: `${base.body}\nPedido ${ref}` } : base;
}

/** Destino al tocar la notificación: el pedido dentro del portal (el id es opaco, nunca un identificador interno). */
export const pushUrlForOrder = (orderOpaqueId: string): string => `/entregas#pedido-${orderOpaqueId}`;

/** Clave de idempotencia lógica (la base la impone con un índice único). */
export const pushDedupeKey = (clientId: string, orderKey: string, type: PushEventType, productKey = ""): string => `${clientId}|${orderKey}|${type}|${productKey}`;

export type OrderSnapshot = {
  orderKey: string;
  orderRef: string | null;
  opaqueId: string;
  /** Estado comercial del pedido (1 a 6). */
  statusId: number;
  cancelled: boolean;
  /** Pedido completo: todos sus productos vigentes listos o entregados. */
  todoListo: boolean;
};

export type OrderStateRow = { lastRank: number };
export type EventDraft = { orderKey: string; orderRef: string | null; opaqueId: string; type: PushEventType; rank: number };
export type StateUpsert = { orderKey: string; orderRef: string | null; rank: number; baseline: boolean; notified: boolean };

/** Estado inicial («baseline»): lo que hay HOY queda como ya notificado, sin eventos. */
export function computeBaseline(orders: ReadonlyArray<OrderSnapshot>): StateUpsert[] {
  const out: StateUpsert[] = [];
  for (const o of orders) {
    if (o.cancelled) continue;
    const rank = pushRankOfStatus(o.statusId);
    if (rank === 0) continue;
    out.push({ orderKey: o.orderKey, orderRef: o.orderRef, rank, baseline: true, notified: false });
  }
  return out;
}

/** Detecta avances de estado respecto de lo ya notificado. */
export function detectTransitions(orders: ReadonlyArray<OrderSnapshot>, state: ReadonlyMap<string, OrderStateRow>): { events: EventDraft[]; upserts: StateUpsert[] } {
  const events: EventDraft[] = [];
  const upserts: StateUpsert[] = [];
  for (const o of orders) {
    if (o.cancelled) continue;
    let rank = pushRankOfStatus(o.statusId);
    if (rank === 0) continue;
    // «Listo»/«Entregado» solo con el pedido completo (el estado del pedido ya es el del producto menos avanzado; doble guarda).
    if (rank >= 5 && !o.todoListo) rank = 4;
    const prev = state.get(o.orderKey);
    if (!prev) {
      if (rank >= 5) {
        upserts.push({ orderKey: o.orderKey, orderRef: o.orderRef, rank, baseline: true, notified: false });
        continue;
      }
      const type = pushTypeOfRank(rank);
      if (!type) continue;
      events.push({ orderKey: o.orderKey, orderRef: o.orderRef, opaqueId: o.opaqueId, type, rank });
      upserts.push({ orderKey: o.orderKey, orderRef: o.orderRef, rank, baseline: false, notified: true });
      continue;
    }
    if (rank <= prev.lastRank) continue; // retroceso, reproceso o sin cambio: no reenvía ni baja lo notificado
    const type = pushTypeOfRank(rank);
    if (!type) {
      upserts.push({ orderKey: o.orderKey, orderRef: o.orderRef, rank, baseline: false, notified: false });
      continue;
    }
    events.push({ orderKey: o.orderKey, orderRef: o.orderRef, opaqueId: o.opaqueId, type, rank });
    upserts.push({ orderKey: o.orderKey, orderRef: o.orderRef, rank, baseline: false, notified: true });
  }
  return { events, upserts };
}

// ───────────────────────── Reintentos ─────────────────────────

export const PUSH_MAX_ATTEMPTS = 6;
/** Un evento que no pudo enviarse en este plazo se descarta (un aviso vencido es peor que ninguno). */
export const PUSH_EVENT_MAX_AGE_MS = 24 * 3_600_000;
export const PUSH_CLAIM_TIMEOUT_MS = 5 * 60_000;
/** Una suscripción con tantos fallos consecutivos (no 404/410) se da de baja. */
export const PUSH_MAX_SUBSCRIPTION_FAILURES = 10;

/** Espera antes del próximo intento: 5, 10, 20, 40, 80 minutos… con tope de 6 horas. */
export function pushBackoffMs(attempts: number): number {
  const n = Math.max(1, attempts);
  return Math.min(5 * 60_000 * 2 ** (n - 1), 6 * 3_600_000);
}

export const OWNER_KEY_USER = (userId: string) => `u:${userId}`;
export const OWNER_KEY_EMAIL = (email: string) => `e:${email.toLowerCase()}`;

/** Un endpoint de suscripción válido: https, sin credenciales, largo razonable. */
export function isValidPushEndpoint(v: unknown): v is string {
  if (typeof v !== "string" || v.length < 20 || v.length > 2048) return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}
const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;
export function parseSubscriptionInput(v: unknown): { endpoint: string; p256dh: string; auth: string } | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const p = o.keys?.p256dh;
  const a = o.keys?.auth;
  if (!isValidPushEndpoint(o.endpoint)) return null;
  if (typeof p !== "string" || typeof a !== "string" || p.length < 60 || p.length > 200 || a.length < 8 || a.length > 64) return null;
  if (!B64URL.test(p) || !B64URL.test(a)) return null;
  return { endpoint: o.endpoint, p256dh: p, auth: a };
}
