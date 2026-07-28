import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { getOrdersService } from "@/lib/orders/get-orders-service";
import { ensureOrdersPersistenceReady, ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = ensureOrdersPersistenceReady();
  if (blocked) return blocked;
  try {
    const actor = resolveOrdersActor(request);
    const url = new URL(request.url);
    const includeDismissed = url.searchParams.get("includeDismissed") === "1";
    const notifications = await getOrdersService().listNotifications(actor, {
      includeDismissed,
    });
    return NextResponse.json({ notifications, legallyOperational: true });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  const blocked = ensureOrdersPersistenceReady();
  if (blocked) return blocked;
  try {
    const actor = resolveOrdersActor(request);
    const body = (await request.json()) as { action?: string };
    const svc = getOrdersService();
    if (body.action === "dismiss_read") {
      await svc.dismissReadNotifications(actor);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "delete_all") {
      const deleted = await svc.deleteAllNotifications(actor);
      return NextResponse.json({ ok: true, deleted });
    }
    return NextResponse.json({ error: "action inválida" }, { status: 400 });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
