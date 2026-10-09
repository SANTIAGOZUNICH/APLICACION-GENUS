import { NextResponse } from "next/server";
import { ensureInventoryPersistenceReady, inventoryErrorResponse, resolveInventoryActor } from "@/lib/inventory/http";
import { meHistoryDb } from "@/lib/inventory/me-planilla-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Historial de cambios (auditoría) de un ingreso, salida o material ME. */
export async function GET(request: Request) {
  try {
    const blocked = ensureInventoryPersistenceReady();
    if (blocked) return blocked;
    const actor = await resolveInventoryActor(request);
    const id = new URL(request.url).searchParams.get("id") ?? "";
    return NextResponse.json({ entries: await meHistoryDb(actor, id) });
  } catch (err) {
    return inventoryErrorResponse(err);
  }
}
