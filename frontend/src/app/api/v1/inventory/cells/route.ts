import { NextResponse } from "next/server";
import { getInventoryService, memoryInventoryRepo } from "@/lib/inventory/get-inventory-service";
import { MAX_INVENTORY_CELL_CHANGES, type InventoryCellChange } from "@/lib/inventory/cell-edit";
import { ensureInventoryPersistenceReady, inventoryErrorResponse, resolveInventoryActor } from "@/lib/inventory/http";
import { hydrateInventoryFromNeon, persistInventorySnapshot } from "@/lib/inventory/neon-persist";
import { MpSheetPatchError, patchMpSheetCells, patchMpStockCells } from "@/lib/inventory/mp-planilla-db";
import type { MpSheetResource } from "@/lib/inventory/mp-sheet-edit";
import { MeSheetPatchError, patchMeSheetCells } from "@/lib/inventory/me-planilla-db";
import type { MeSheetResource } from "@/lib/inventory/me-sheet-edit";
import type { InventoryActor } from "@/lib/inventory/inventory-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ME_SHEETS = new Set<string>(["me_ingresos", "me_salidas", "me_inventario"]);
const MP_SHEETS = new Set<string>(["mp_stock", "mp_ingresos", "mp_compras"]);

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
 *  - Materias Primas (`mp_stock`, `mp_ingresos`, `mp_compras`): una transacción por guardado con el servicio de
 *    inventario sobre datos leídos en ella; los kg de un lote se corrigen con motivo y quedan en el libro mayor.
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
    if (!MP_SHEETS.has(body.resource)) return NextResponse.json({ error: "Recurso inválido." }, { status: 400 });
    try {
      const { items } =
        body.resource === "mp_stock"
          ? await patchMpStockCells(actor, body.changes)
          : await patchMpSheetCells(actor, body.resource as MpSheetResource, body.changes);
      return NextResponse.json({ ok: true, results: body.changes.map(() => ({ ok: true })), items });
    } catch (err) {
      if (err instanceof MpSheetPatchError) return NextResponse.json({ ok: false, error: err.message, results: err.results }, { status: err.status });
      throw err;
    }
  } catch (err) {
    return inventoryErrorResponse(err);
  }
}
