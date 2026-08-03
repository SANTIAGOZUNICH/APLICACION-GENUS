import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { getOrdersService } from "@/lib/orders/get-orders-service";
import { ensureOrdersPersistenceReady, ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  const blocked = ensureOrdersPersistenceReady();
  if (blocked) return blocked;
  try {
    const actor = await resolveOrdersActor(request);
    const { id } = await ctx.params;
    const body = (await request.json()) as { action?: string };
    const svc = getOrdersService();
    if (body.action === "dismiss") {
      await svc.dismissNotification(id, actor);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "restore") {
      await svc.restoreNotification(id, actor);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "read") {
      await svc.markNotificationRead(id, actor);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "action inválida" }, { status: 400 });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
