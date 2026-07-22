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
    const notifications = await getOrdersService().listNotifications(actor);
    return NextResponse.json({ notifications, legallyOperational: true });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
