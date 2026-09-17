import { NextResponse } from "next/server";
import { getAsignacionLoteSourcesService } from "@/lib/asignacion-lotes/asignacion-lote-sources-service";
import { syncSourceById } from "@/lib/asignacion-lotes/asignacion-lotes-sync-service";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError, OrdersNotFoundError } from "@/lib/orders/types";
import { canConfigureAsignacionLoteSources } from "@/features/os/operational/lib/asignacion-lote-sources-rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** [ SINCRONIZAR AHORA ] — disparo manual inmediato. */
export async function POST(request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const actor = await resolveOrdersActor(request);
    if (!canConfigureAsignacionLoteSources(actor.sector)) {
      throw new OrdersForbiddenError("No tenés permiso para sincronizar fuentes de Asignación de Lotes.");
    }
    const source = await getAsignacionLoteSourcesService().getForSync(id);
    if (!source) throw new OrdersNotFoundError("Fuente no encontrada.");
    const summary = await syncSourceById(id, actor.email, "manual");
    return NextResponse.json({ run: summary });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
