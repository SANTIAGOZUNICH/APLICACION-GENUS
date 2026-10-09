import { NextResponse } from "next/server";
import { getAsignacionLotesService } from "@/lib/asignacion-lotes/asignacion-lotes-service";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Historial de cambios de un lote (solo lectura; mismos sectores que el módulo). */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveOrdersActor(request);
    const { id } = await ctx.params;
    const entries = await getAsignacionLotesService().history({ email: actor.email, sector: actor.sector, displayName: actor.displayName }, id);
    return NextResponse.json({ entries });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
