import { NextResponse } from "next/server";
import { ensureInventoryPersistenceReady, inventoryErrorResponse, resolveInventoryActor } from "@/lib/inventory/http";
import { meDeletionHistoryDb } from "@/lib/inventory/me-planilla-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Historial interno de eliminaciones de Depósito ME (auditoría). `resource` = me_ingresos | me_salidas | me_stock. */
export async function GET(request: Request) {
  try {
    const blocked = ensureInventoryPersistenceReady();
    if (blocked) return blocked;
    const actor = await resolveInventoryActor(request);
    const resource = new URL(request.url).searchParams.get("resource") ?? "me_ingresos";
    if (resource !== "me_ingresos" && resource !== "me_salidas" && resource !== "me_stock") {
      return NextResponse.json({ error: "Recurso inválido." }, { status: 400 });
    }
    return NextResponse.json({ entries: await meDeletionHistoryDb(actor, resource) });
  } catch (err) {
    return inventoryErrorResponse(err);
  }
}
