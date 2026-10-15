import "server-only";

import { getDb } from "@/lib/db/client";
import { osNotifications } from "@/lib/db/schema";
import { buildCircuitNotification, type CircuitMovement } from "./movements";

/**
 * Notificación a Producción de un movimiento del circuito. DECISIÓN DE DISEÑO (documentada en
 * docss/59-circuito-sin-calidad.md): se inserta DESPUÉS de confirmar la transacción del movimiento, de forma
 * best-effort. Una falla de la notificación NUNCA revierte ni bloquea la entrega/transferencia (el movimiento es el
 * hecho operativo; el aviso es derivado). La idempotencia la da el id determinístico (sha256 de tipo + trabajo +
 * clave del evento) + onConflictDoNothing: un reintento del mismo movimiento (replay) vuelve a intentar el aviso sin
 * duplicarlo, y si la primera inserción había fallado, el reintento lo recupera.
 */
export async function emitCircuitNotification(movement: CircuitMovement): Promise<{ id: string; ok: boolean }> {
  const draft = buildCircuitNotification(movement);
  try {
    await getDb()
      .insert(osNotifications)
      .values({
        id: draft.id,
        kind: draft.kind,
        title: draft.title,
        message: draft.message,
        sectors: draft.sectors,
        href: draft.href,
        readBy: [],
        dismissedBy: [],
        deletedBy: [],
      })
      .onConflictDoNothing();
    return { id: draft.id, ok: true };
  } catch (error) {
    console.error("[circuito] no se pudo registrar la notificación (el movimiento ya quedó confirmado)", {
      workItemId: movement.workItemId,
      type: movement.type,
      error,
    });
    return { id: draft.id, ok: false };
  }
}
