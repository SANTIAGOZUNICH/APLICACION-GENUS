import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { getOrdersService } from "@/lib/orders/get-orders-service";
import { ensureOrdersPersistenceReady, ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Elimina (soft-delete) una OE en cualquier estado. La autoridad real es OrdersService.deleteOe(): sector
 * (Producción/Dirección), motivo obligatorio y que sea una OE. No modifica el stock de MP.
 */
export async function POST(request: Request, ctx: Ctx) {
  const blocked = ensureOrdersPersistenceReady();
  if (blocked) return blocked;
  try {
    const { id } = await ctx.params;
    const actor = await resolveOrdersActor(request);
    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const order = await getOrdersService().deleteOe(id, actor, body.reason ?? "");
    return NextResponse.json({ order });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
