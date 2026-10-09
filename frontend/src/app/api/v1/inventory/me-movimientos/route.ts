import { NextResponse } from "next/server";
import { ensureInventoryPersistenceReady, inventoryErrorResponse, resolveInventoryActor } from "@/lib/inventory/http";
import { meMovementsDb } from "@/lib/inventory/me-planilla-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Libro de movimientos (con saldo) de un material ME: ingresos, salidas que descuentan y ajustes. */
export async function GET(request: Request) {
  try {
    const blocked = ensureInventoryPersistenceReady();
    if (blocked) return blocked;
    const actor = await resolveInventoryActor(request);
    const materialId = new URL(request.url).searchParams.get("materialId") ?? "";
    return NextResponse.json(await meMovementsDb(actor, materialId));
  } catch (err) {
    return inventoryErrorResponse(err);
  }
}
