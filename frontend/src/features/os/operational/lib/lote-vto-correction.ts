import type { SectorId } from "@/types/operational/sector";
import { postUpdateLoteVto } from "@/lib/api/live-sync-client";

/**
 * Corrección de Lote/VTO por Producción (PARTE A — "fuente única").
 * Envasado/Codificado ya no pueden editar estos campos (ver
 * packaging-quantities-block.tsx y saveWorkProgressDurable); esta es la
 * única puerta de entrada para cambiarlos después de la asignación. El
 * servidor exige sector PRODUCCION y un motivo no vacío, y deja auditoría
 * en operational_events (valor anterior, nuevo, actor, fecha, motivo).
 */
export type LoteVtoCorrectionResult =
  | { ok: true }
  | { ok: false; error: string; code?: string };

export async function correctWorkItemLoteVto(input: {
  itemId: string;
  packagingLote?: string | null;
  packagingVto?: string | null;
  reason: string;
  actorSectorId: SectorId;
  updatedBy?: string;
}): Promise<LoteVtoCorrectionResult> {
  const reason = input.reason.trim();
  if (!reason) {
    return { ok: false, error: "Indicá el motivo de la corrección." };
  }
  if (
    (input.packagingLote === undefined || input.packagingLote === null) &&
    (input.packagingVto === undefined || input.packagingVto === null)
  ) {
    return { ok: false, error: "Indicá el nuevo Lote y/o VTO." };
  }

  let response: Response;
  try {
    response = await postUpdateLoteVto({
      itemId: input.itemId,
      packagingLote: input.packagingLote,
      packagingVto: input.packagingVto,
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
      error: body.error ?? "No se pudo corregir Lote/VTO.",
      code: body.code,
    };
  }
  return { ok: true };
}
