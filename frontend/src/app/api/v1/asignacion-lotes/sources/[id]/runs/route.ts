import { NextResponse } from "next/server";
import { getAsignacionLoteSourcesService } from "@/lib/asignacion-lotes/asignacion-lote-sources-service";
import { listSyncRuns } from "@/lib/asignacion-lotes/asignacion-lotes-sync-service";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function toActor(actor: Awaited<ReturnType<typeof resolveOrdersActor>>) {
  return { email: actor.email, sector: actor.sector, displayName: actor.displayName };
}

/** Historial de ejecuciones — panel de estado (+N nuevos / M actualizados / errores). */
export async function GET(request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const actor = await resolveOrdersActor(request);
    // Reutiliza el mismo gate que list() de fuentes — get() ya valida acceso.
    await getAsignacionLoteSourcesService().get(toActor(actor), id);
    const runs = await listSyncRuns(id, 20);
    return NextResponse.json({ runs });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
