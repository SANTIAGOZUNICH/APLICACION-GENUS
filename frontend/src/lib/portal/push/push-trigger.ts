/**
 * Disparo INMEDIATO de notificaciones tras un cambio real de estado (asignar a Elaboración, enviar a Envasado, marcar «Listo»,
 * entregar, cambiar el estado del pedido, pedido nuevo, cancelar, reprocesar…). Desacoplado de Producción por construcción:
 *  - se programa DESPUÉS de confirmada la operación (`after` de Next, o en segundo plano fuera de un request) y nunca se espera;
 *  - todo error se captura y se registra: un fallo de envío JAMÁS cambia el resultado de la operación de Producción;
 *  - es idempotente (índice único del outbox): si además corre el cron, no hay duplicados.
 * Si no se dispara (cualquier motivo), el cron `/api/cron/portal-push` (cada 2 minutos, sin sesión ni portal abierto) detecta igual la
 * transición en la próxima corrida: es la red de seguridad.
 *
 * Cobertura: `withPortalPush` envuelve las rutas de escritura de los sectores (Producción, Elaboración, Envasado, Codificado, Depósito/Entregas).
 */
import "server-only";

import { after } from "next/server";
import { getDb } from "@/lib/db/client";

export type PortalPushRef = {
  pedidoId?: string | null;
  workItemId?: string | null;
  clientId?: string | null;
  /** Sin referencia conocida: recorre los clientes del piloto (acotado por un antirrebote). */
  all?: boolean;
};

const inflight = new Set<Promise<void>>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALL_DEBOUNCE_MS = 10_000;
let lastAllRunAt = 0;

async function run(ref: PortalPushRef): Promise<void> {
  try {
    const { portalClientOfPedido, portalClientOfWork, isPilotEnabled, runPushWorker } = await import("./push-service");
    const db = getDb();
    let clientId = ref.clientId && UUID.test(ref.clientId) ? ref.clientId : null;
    if (!clientId && ref.pedidoId && UUID.test(ref.pedidoId)) clientId = await portalClientOfPedido(db, ref.pedidoId);
    if (!clientId && ref.workItemId && UUID.test(ref.workItemId.replace(/^native:/, ""))) clientId = await portalClientOfWork(db, ref.workItemId.replace(/^native:/, ""));
    if (!clientId) {
      // Histórico sin ID de cliente, o cambio sin referencia (p. ej. anular una entrega): se recorre el piloto, una vez cada pocos segundos.
      if (!ref.all && !ref.pedidoId && !ref.workItemId) return;
      if (Date.now() - lastAllRunAt < ALL_DEBOUNCE_MS) return;
      lastAllRunAt = Date.now();
      await runPushWorker({ db, trigger: "inmediato" });
      return;
    }
    if (!(await isPilotEnabled(db, clientId))) return;
    await runPushWorker({ db, trigger: "inmediato", onlyClientId: clientId });
  } catch (err) {
    console.error("[portal-push] disparo inmediato falló (sin efecto sobre Producción; el cron lo reintenta)", err);
  }
}

/** Programa el disparo y devuelve de inmediato. Nunca lanza. */
export function schedulePortalPush(ref: PortalPushRef): void {
  try {
    if (process.env.VITEST === "true" || process.env.GENUS_PORTAL_PUSH_INLINE === "off") return;
    const task = () => {
      const p = run(ref).finally(() => inflight.delete(p));
      inflight.add(p);
      return p;
    };
    try {
      after(task);
    } catch {
      void task(); // fuera de un request (scripts, pruebas): en segundo plano
    }
  } catch (err) {
    console.error("[portal-push] no se pudo programar el disparo inmediato", err);
  }
}

/** Solo para pruebas: espera a que terminen los disparos en curso. */
export async function flushPortalPushTriggers(): Promise<void> {
  while (inflight.size) await Promise.allSettled([...inflight]);
}

/** Referencias (trabajo / pedido) que el cuerpo de una operación de los sectores trae; vacío si no se identifican. */
export function refsFromBody(body: unknown): PortalPushRef {
  if (!body || typeof body !== "object") return {};
  const b = body as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" && v ? v : null);
  const work = s(b.workItemId) ?? s(b.itemId) ?? s(b.work_item_id);
  const pedido = s(b.pedidoId) ?? s(b.productionPedidoId);
  return { workItemId: work, pedidoId: pedido };
}

/**
 * Envuelve una ruta de escritura: si la operación terminó bien (< 400) programa el disparo inmediato. `idParam` indica qué es el `id` de la
 * ruta dinámica (trabajo o pedido). No cambia nada de la respuesta ni espera al envío: un fallo acá nunca llega al usuario de planta.
 */
export function withPortalPush<A extends unknown[]>(
  handler: (request: Request, ...rest: A) => Promise<Response>,
  opts: { idParam?: "work" | "pedido" } = {},
): (request: Request, ...rest: A) => Promise<Response> {
  return async (request, ...rest) => {
    let ref: PortalPushRef = {};
    try {
      if (opts.idParam) {
        const ctx = rest[0] as { params?: Promise<{ id?: string }> } | undefined;
        const id = (await ctx?.params)?.id;
        if (id) ref = opts.idParam === "work" ? { workItemId: id } : { pedidoId: id };
      }
      if (!ref.workItemId && !ref.pedidoId) ref = refsFromBody(await request.clone().json().catch(() => null));
    } catch {
      ref = {};
    }
    const res = await handler(request, ...rest);
    try {
      if (res.status < 400) schedulePortalPush(ref.workItemId || ref.pedidoId ? ref : { all: true });
    } catch {
      /* nunca afecta a la operación */
    }
    return res;
  };
}
