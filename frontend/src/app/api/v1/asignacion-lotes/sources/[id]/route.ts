import { NextResponse } from "next/server";
import { getAsignacionLoteSourcesService } from "@/lib/asignacion-lotes/asignacion-lote-sources-service";
import type { AsignacionLoteSourceUpdateInput } from "@/lib/asignacion-lotes/source-types";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function toActor(actor: Awaited<ReturnType<typeof resolveOrdersActor>>) {
  return { email: actor.email, sector: actor.sector, displayName: actor.displayName };
}

/** Editar nombre/hoja/prioridad o [ DESACTIVAR SINCRONIZACIÓN ] (nunca borra datos). */
export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const actor = await resolveOrdersActor(request);
    const body = (await request.json()) as AsignacionLoteSourceUpdateInput;
    const source = await getAsignacionLoteSourcesService().update(toActor(actor), id, body);
    return NextResponse.json({ source });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
