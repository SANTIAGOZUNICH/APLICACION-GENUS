import "server-only";

import { getDb } from "@/lib/db/client";
import { osNotifications } from "@/lib/db/schema";
import type { RecordDeliveryResult } from "@/lib/planning/circuit/delivery-core";
import { buildObservationNotification, type ObservationNotificationInput } from "./observation-notification-builder";
import { tipoFromPending } from "@/lib/observations/production-observations-core";

/**
 * Aviso a Producción de una observación de entrega. Se inserta DESPUÉS de confirmar la entrega, de forma best-effort e idempotente
 * (id determinístico + onConflictDoNothing): un reintento o replay no duplica el aviso, y una falla JAMÁS revierte ni bloquea la
 * entrega (esta función nunca lanza). Sin observación no hace nada.
 */
export async function emitObservationNotification(input: ObservationNotificationInput): Promise<{ id: string | null; ok: boolean }> {
  try {
    const draft = buildObservationNotification(input);
    if (!draft) return { id: null, ok: true };
    await getDb()
      .insert(osNotifications)
      .values({ id: draft.id, kind: draft.kind, title: draft.title, message: draft.message, sectors: draft.sectors, href: draft.href, readBy: [], dismissedBy: [], deletedBy: [] })
      .onConflictDoNothing();
    return { id: draft.id, ok: true };
  } catch (error) {
    console.error("[observaciones] no se pudo registrar el aviso (la entrega ya quedó confirmada)", { workItemId: input.workItemId, error });
    return { id: null, ok: false };
  }
}

/** Entrega (parcial o total) a Producción/Cliente recién registrada, con renglón de entrega. También en el replay (idempotente). */
export async function emitObservationForDelivery(result: RecordDeliveryResult, actorName: string): Promise<void> {
  try {
    const line = result.line;
    if (!line || !line.observations?.trim()) return;
    await emitObservationNotification({
      source: "LINEA",
      eventKey: line.id,
      workItemId: result.item.id,
      sector: line.sourceSector,
      actorName,
      observation: line.observations,
      at: line.actualDeliveredAt ?? new Date(),
      client: result.item.client ?? null,
      product: result.item.product ?? null,
      pedido: result.delivery?.pedidoOp ?? null,
      orderRef: result.item.orderNumber ?? null,
      lote: result.item.packagingLote ?? null,
      quantity: line.quantity,
      unit: line.unit ?? result.item.unit ?? null,
      tipo: tipoFromPending(line.pendingAfter),
    });
  } catch (error) {
    console.error("[observaciones] aviso de entrega falló", error);
  }
}
