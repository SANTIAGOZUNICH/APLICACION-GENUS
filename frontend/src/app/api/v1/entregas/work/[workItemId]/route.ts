import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { entregasService } from "@/lib/entregas/service";
import { entregasErrorResponse } from "@/lib/entregas/http";
import { OrdersValidationError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ workItemId: string }> };

/** Historial de las correcciones hechas desde el calendario sobre un trabajo («Desde trabajo»). */
export async function GET(request: Request, ctx: Ctx) {
  try {
    const actor = await resolveOrdersActor(request);
    const { workItemId } = await ctx.params;
    return NextResponse.json({ history: await entregasService.workHistory(actor, workItemId) });
  } catch (err) {
    return entregasErrorResponse(err);
  }
}

type Body = {
  action?: string;
  reason?: string;
  deliveryDate?: string | null;
  plannedQuantity?: string | null;
  notes?: string | null;
};

/**
 * Entrega «Desde trabajo» (un trabajo sin entrega programada): editar fecha / cantidad / observaciones (en el trabajo),
 * quitarla del calendario (lógico, con motivo) o restaurarla. Las entregas REALES no se tocan desde acá.
 */
export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const actor = await resolveOrdersActor(request);
    const { workItemId } = await ctx.params;
    const body = (await request.json().catch(() => null)) as Body | null;
    if (!body?.action) throw new OrdersValidationError("action es obligatoria.");
    switch (body.action) {
      case "edit": {
        const changes: { deliveryDate?: string | null; plannedQuantity?: string | null; notes?: string | null } = {};
        if ("deliveryDate" in body) changes.deliveryDate = body.deliveryDate ?? null;
        if ("plannedQuantity" in body) changes.plannedQuantity = body.plannedQuantity ?? null;
        if ("notes" in body) changes.notes = body.notes ?? null;
        return NextResponse.json(await entregasService.editWork(actor, workItemId, changes, body.reason));
      }
      case "hide":
        await entregasService.hideWork(actor, workItemId, body.reason);
        return NextResponse.json({ ok: true });
      case "restore":
        await entregasService.restoreWork(actor, workItemId, body.reason);
        return NextResponse.json({ ok: true });
      default:
        throw new OrdersValidationError("action desconocida.");
    }
  } catch (err) {
    return entregasErrorResponse(err);
  }
}
