/**
 * Side-effect suave tras aprobación Calidad (salida/envasado).
 * Nunca rompe el flujo de calidad si remitos schema pendiente o falla.
 */
import { qualityItemIdForWorkItem } from "@/features/os/operational/lib/completion-events";
import { serverOperationalState } from "@/lib/live-sync/server-operational-state";
import { RemitoSchemaPendingError } from "@/lib/db/remito-schema";
import { getRemitoService } from "@/lib/remitos/remito-service";
import type { SectorId } from "@/types/operational/sector";

function parseTotalUnits(quantity: string | null | undefined, finishedQty?: string): number {
  const raw = (finishedQty || quantity || "").replace(",", ".");
  const m = raw.match(/-?\d+(\.\d+)?/);
  return m ? Math.max(0, Number(m[0])) : 0;
}

export async function softUpsertRemitoFromQualityApproval(params: {
  itemId: string;
  status: "aprobado" | "rechazado";
  actorEmail?: string;
  actorSector?: SectorId;
}): Promise<void> {
  if (params.status !== "aprobado") return;

  try {
    const snap = serverOperationalState.snapshot();
    const workItemId = params.itemId.startsWith("qc:")
      ? params.itemId.slice(3)
      : params.itemId;

    const completion =
      snap.completions.find((c) => c.workItemId === workItemId) ??
      snap.completions.find((c) => qualityItemIdForWorkItem(c.workItemId) === params.itemId);

    // Solo salida/envasado (no granel elaboración)
    if (completion && completion.kind === "granel") return;

    const client =
      completion?.client?.trim() ||
      "Sin cliente";
    const deliveryDate =
      completion?.deliveryDate?.trim() ||
      new Date().toISOString().slice(0, 10);
    const product = completion?.product?.trim() || "Producto";
    const totalUnits = parseTotalUnits(
      completion?.quantityPlanned,
      completion?.finishedQty
    );

    await getRemitoService().upsertDraftFromApproval(
      {
        email: params.actorEmail || "calidad@system",
        sector: (params.actorSector as SectorId) || "CALIDAD",
      },
      {
        workItemId,
        clientId: client,
        clientDisplay: client,
        deliveryDate,
        product,
        lote: completion?.loteRef ?? null,
        vto: null,
        totalUnits: totalUnits || 1,
      },
      { systemHook: true }
    );
  } catch (err) {
    if (err instanceof RemitoSchemaPendingError) return;
    // Soft-fail: no romper aprobación de calidad
    console.warn("[remitos] soft upsert after quality approve failed:", err);
  }
}
