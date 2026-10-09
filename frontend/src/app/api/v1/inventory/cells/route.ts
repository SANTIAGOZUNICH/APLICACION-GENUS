import { NextResponse } from "next/server";
import { getInventoryService, memoryInventoryRepo } from "@/lib/inventory/get-inventory-service";
import { MAX_INVENTORY_CELL_CHANGES, type InventoryCellChange } from "@/lib/inventory/cell-edit";
import { ensureInventoryPersistenceReady, inventoryErrorResponse, resolveInventoryActor } from "@/lib/inventory/http";
import { hydrateInventoryFromNeon, persistInventorySnapshot, persistMpStockSnapshot, refreshMpInventoryFromNeon } from "@/lib/inventory/neon-persist";
import { MeSheetPatchError, patchMeSheetCells } from "@/lib/inventory/me-planilla-db";
import type { MeSheetResource } from "@/lib/inventory/me-sheet-edit";
import type { InventoryActor } from "@/lib/inventory/inventory-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ME_SHEETS = new Set<string>(["me_ingresos", "me_salidas", "me_inventario"]);

/** Los avisos de stock se recalculan con el estado YA confirmado en la base (best-effort: nunca rompen el guardado). */
async function refreshMeAlerts(actor: InventoryActor, materialIds: string[]) {
  try {
    await hydrateInventoryFromNeon(memoryInventoryRepo, { force: true });
    const svc = getInventoryService();
    for (const id of new Set(materialIds)) if (memoryInventoryRepo.getMeMaterial(id)) svc.syncMeAlertsPublic(actor, id);
    await persistInventorySnapshot(memoryInventoryRepo);
  } catch (err) {
    console.error("[inventory] avisos ME", err);
  }
}

/**
 * PATCH por celda.
 *  - Depósito ME (`me_ingresos`, `me_salidas`, `me_inventario`): escritura TRANSACCIONAL en Postgres (versión por fila,
 *    candado por código, auditoría, todo-o-nada). El stock nunca se edita: se calcula.
 *  - Stock MP (`mp_stock`): camino existente (sin cambios en esta etapa).
 */
export async function PATCH(request: Request) {
  try {
    const blocked = ensureInventoryPersistenceReady();
    if (blocked) return blocked;
    const actor = await resolveInventoryActor(request);
    const body = (await request.json()) as { resource?: string; changes?: InventoryCellChange[] };
    if (!body.resource || !Array.isArray(body.changes) || body.changes.length > MAX_INVENTORY_CELL_CHANGES) {
      return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
    }
    if (ME_SHEETS.has(body.resource)) {
      try {
        const { items } = await patchMeSheetCells(actor, body.resource as MeSheetResource, body.changes);
        await refreshMeAlerts(actor, items.flatMap((i) => [String(i.materialId ?? ""), body.resource === "me_inventario" ? i.id : ""]).filter(Boolean));
        return NextResponse.json({ ok: true, results: body.changes.map(() => ({ ok: true })), items });
      } catch (err) {
        if (err instanceof MeSheetPatchError) return NextResponse.json({ ok: false, error: err.message, results: err.results }, { status: err.status });
        throw err;
      }
    }
    if (body.resource !== "mp_stock") return NextResponse.json({ error: "Recurso inválido." }, { status: 400 });
    // Se parte siempre del estado confirmado en la base (no de una copia en memoria vieja).
    await hydrateInventoryFromNeon(memoryInventoryRepo, { force: true });
    await refreshMpInventoryFromNeon(memoryInventoryRepo);
    const results = getInventoryService().patchInventoryCells(actor, "mp_stock", body.changes);
    const ok = results.every((r) => r.ok);
    if (results.some((r) => r.ok)) {
      await persistInventorySnapshot(memoryInventoryRepo);
      await persistMpStockSnapshot(memoryInventoryRepo.mpStock);
    }
    const status = ok ? 200 : results.some((r) => !r.ok && r.code === "CONFLICT") ? 409 : 422;
    return NextResponse.json({ ok, results }, { status });
  } catch (err) {
    return inventoryErrorResponse(err);
  }
}
