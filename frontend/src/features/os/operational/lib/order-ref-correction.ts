import type { SectorId } from "@/types/operational/sector";
import { postUpdateOrderRef } from "@/lib/api/live-sync-client";

/**
 * Corrección de OA/OE vinculada a un trabajo ya asignado. Exige que la
 * OA/OE de destino ya exista (nunca se auto-crea desde acá — ver
 * updateWorkItemOrderRefDurable) y un motivo no vacío; queda auditada en
 * operational_events (valor anterior, nuevo, actor, motivo).
 */
export type OrderRefCorrectionResult =
  | { ok: true }
  | { ok: false; error: string; code?: string };

export async function correctWorkItemOrderRef(input: {
  itemId: string;
  orderNumberRaw: string;
  reason: string;
  actorSectorId: SectorId;
  updatedBy?: string;
}): Promise<OrderRefCorrectionResult> {
  const reason = input.reason.trim();
  if (!reason) {
    return { ok: false, error: "Indicá el motivo de la corrección." };
  }
  if (!input.orderNumberRaw.trim()) {
    return { ok: false, error: "Indicá el número de OA/OE." };
  }

  let response: Response;
  try {
    response = await postUpdateOrderRef({
      itemId: input.itemId,
      orderNumberRaw: input.orderNumberRaw.trim(),
      reason,
      updatedBy: input.updatedBy,
      actorSectorId: input.actorSectorId,
    });
  } catch {
    return { ok: false, error: "Sin conexión con el servidor. Reintentá." };
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
    };
    return {
      ok: false,
      error: body.error ?? "No se pudo corregir la OA/OE.",
      code: body.code,
    };
  }
  return { ok: true };
}
