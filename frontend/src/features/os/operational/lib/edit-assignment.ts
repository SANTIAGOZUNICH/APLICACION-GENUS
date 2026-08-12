import type { SectorId } from "@/types/operational/sector";
import { postEditAssignment } from "@/lib/api/live-sync-client";

/**
 * Edición de campos de planificación (producto/cliente/cantidad/fecha de
 * entrega/observaciones) por Producción sobre un trabajo ya asignado, en
 * cualquiera de los 4 sectores que gestiona (Elaboración/Masivo/Premium/
 * Codificado). Nunca toca campos de ejecución de otro sector — ver
 * updateWorkItemPlanningDurable. Lote/VTO usan su propio mecanismo
 * (lote-vto-correction.ts) — no se duplica acá.
 */
export type EditAssignmentResult = { ok: true } | { ok: false; error: string; code?: string };

export async function editWorkItemAssignment(input: {
  itemId: string;
  client?: string | null;
  product?: string | null;
  plannedQuantity?: string | null;
  unit?: string | null;
  deliveryDate?: string | null;
  notes?: string | null;
  reason?: string | null;
  actorSectorId: SectorId;
  updatedBy?: string;
}): Promise<EditAssignmentResult> {
  let response: Response;
  try {
    response = await postEditAssignment({
      itemId: input.itemId,
      client: input.client,
      product: input.product,
      plannedQuantity: input.plannedQuantity,
      unit: input.unit,
      deliveryDate: input.deliveryDate,
      notes: input.notes,
      reason: input.reason,
      updatedBy: input.updatedBy,
      actorSectorId: input.actorSectorId,
    });
  } catch {
    return { ok: false, error: "Sin conexión con el servidor. Reintentá." };
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
    return { ok: false, error: body.error ?? "No se pudo editar el trabajo.", code: body.code };
  }
  return { ok: true };
}
