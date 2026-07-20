import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { getOrdersService } from "@/lib/orders/get-orders-service";
import { ensureOrdersPersistenceReady, ordersErrorResponse } from "@/lib/orders/http";
import type { OrderDocType } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = ensureOrdersPersistenceReady();
  if (blocked) return blocked;
  try {
    resolveOrdersActor(request);
    const url = new URL(request.url);
    const type = url.searchParams.get("type") as OrderDocType | null;
    const templates = await getOrdersService().listTemplates(type ?? undefined);
    return NextResponse.json({ templates, legallyOperational: true });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
