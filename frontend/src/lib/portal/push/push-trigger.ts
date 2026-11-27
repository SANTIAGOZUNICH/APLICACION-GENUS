/**
 * Disparo INMEDIATO de notificaciones tras un cambio real de estado (asignar a Elaboración, enviar a Envasado, marcar «Listo»,
 * pedido nuevo). Desacoplado de Producción por construcción:
 *  - se programa DESPUÉS de confirmada la operación (`after` de Next, o en segundo plano fuera de un request) y nunca se espera;
 *  - todo error se captura y se registra: un fallo de envío JAMÁS cambia el resultado de la operación de Producción;
 *  - es idempotente (índice único del outbox): si además corre el cron, no hay duplicados.
 * Si no se dispara (cualquier motivo), el cron `/api/cron/portal-push` detecta igual la transición en la próxima corrida.
 */
import "server-only";

import { after } from "next/server";
import { getDb } from "@/lib/db/client";

export type PortalPushRef = { pedidoId?: string | null; workItemId?: string | null; clientId?: string | null };

const inflight = new Set<Promise<void>>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function run(ref: PortalPushRef): Promise<void> {
  try {
    const { portalClientOfPedido, portalClientOfWork, isPilotEnabled, runPushWorker } = await import("./push-service");
    const db = getDb();
    let clientId = ref.clientId && UUID.test(ref.clientId) ? ref.clientId : null;
    if (!clientId && ref.pedidoId && UUID.test(ref.pedidoId)) clientId = await portalClientOfPedido(db, ref.pedidoId);
    if (!clientId && ref.workItemId && UUID.test(ref.workItemId.replace(/^native:/, ""))) clientId = await portalClientOfWork(db, ref.workItemId.replace(/^native:/, ""));
    if (!clientId) return; // histórico sin ID de cliente: lo recoge el cron
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
