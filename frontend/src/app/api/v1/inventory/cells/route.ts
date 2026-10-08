import { NextResponse } from "next/server";
import { getInventoryService, memoryInventoryRepo } from "@/lib/inventory/get-inventory-service";
import { MAX_INVENTORY_CELL_CHANGES, type InventoryCellChange, type InventoryCellResource } from "@/lib/inventory/cell-edit";
import { ensureInventoryPersistenceReady, inventoryErrorResponse, resolveInventoryActor } from "@/lib/inventory/http";
import { hydrateInventoryFromNeon, persistInventorySnapshot, persistMpStockSnapshot, refreshMpInventoryFromNeon } from "@/lib/inventory/neon-persist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH parcial por celda: Inventario ME (`me_inventario`) y Stock MP (`mp_stock`). */
export async function PATCH(request: Request) {
  try {
    const blocked = ensureInventoryPersistenceReady();
    if (blocked) return blocked;
    const actor = await resolveInventoryActor(request);
    const body = (await request.json()) as { resource?: InventoryCellResource; changes?: InventoryCellChange[] };
    if ((body.resource !== "me_inventario" && body.resource !== "mp_stock") || !Array.isArray(body.changes) || body.changes.length > MAX_INVENTORY_CELL_CHANGES) {
      return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
    }
    // Se parte siempre del estado confirmado en la base (no de una copia en memoria vieja).
    await hydrateInventoryFromNeon(memoryInventoryRepo, { force: true });
    await refreshMpInventoryFromNeon(memoryInventoryRepo);
    const results = getInventoryService().patchInventoryCells(actor, body.resource, body.changes);
    const ok = results.every((r) => r.ok);
    if (results.some((r) => r.ok)) {
      await persistInventorySnapshot(memoryInventoryRepo);
      if (body.resource === "mp_stock") await persistMpStockSnapshot(memoryInventoryRepo.mpStock);
    }
    const status = ok ? 200 : results.some((r) => !r.ok && r.code === "CONFLICT") ? 409 : 422;
    return NextResponse.json({ ok, results }, { status });
  } catch (err) {
    return inventoryErrorResponse(err);
  }
}
