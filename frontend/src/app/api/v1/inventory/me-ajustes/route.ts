import { NextResponse } from "next/server";
import { getInventoryService, memoryInventoryRepo } from "@/lib/inventory/get-inventory-service";
import { ensureInventoryPersistenceReady, inventoryErrorResponse, resolveInventoryActor } from "@/lib/inventory/http";
import { hydrateInventoryFromNeon, persistInventorySnapshot } from "@/lib/inventory/neon-persist";
import { adjustMeStockDb, type MeAjusteInput } from "@/lib/inventory/me-planilla-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ajuste de inventario ME (Depósito / Producción): motivo, stock esperado (409 si cambió) y auditoría. */
export async function POST(request: Request) {
  try {
    const blocked = ensureInventoryPersistenceReady();
    if (blocked) return blocked;
    const actor = await resolveInventoryActor(request);
    const body = (await request.json().catch(() => ({}))) as Partial<MeAjusteInput>;
    const result = await adjustMeStockDb(actor, {
      materialId: String(body.materialId ?? ""),
      expectedStock: Number(body.expectedStock),
      newStock: Number(body.newStock),
      motivo: String(body.motivo ?? ""),
      tipo: String(body.tipo ?? "OTRO"),
    });
    try {
      await hydrateInventoryFromNeon(memoryInventoryRepo, { force: true });
      getInventoryService().syncMeAlertsPublic(actor, String(body.materialId));
      await persistInventorySnapshot(memoryInventoryRepo);
    } catch (err) {
      console.error("[inventory] avisos ME tras ajuste", err);
    }
    return NextResponse.json(result);
  } catch (err) {
    return inventoryErrorResponse(err);
  }
}
