import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { getOrdersService } from "@/lib/orders/get-orders-service";
import { ensureOrdersPersistenceReady, ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const blocked = ensureOrdersPersistenceReady();
  if (blocked) return blocked;
  try {
    const { id } = await ctx.params;
    const actor = resolveOrdersActor(request);
    const body = (await request.json()) as {
      confirm?: boolean;
      allowIncomplete?: boolean;
      allowNegativeMeStock?: boolean;
      negativeMeStockReason?: string;
      includeDesechadosMe?: boolean;
    };
    const order = await getOrdersService().deliver(id, actor, Boolean(body.confirm), {
      allowIncomplete: Boolean(body.allowIncomplete),
      allowNegativeMeStock: Boolean(body.allowNegativeMeStock),
      negativeMeStockReason: body.negativeMeStockReason,
      includeDesechadosMe: Boolean(body.includeDesechadosMe),
    });
    return NextResponse.json({ order, legallyOperational: true });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
