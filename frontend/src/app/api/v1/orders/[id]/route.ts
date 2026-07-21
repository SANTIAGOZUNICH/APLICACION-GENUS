import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { getOrdersService } from "@/lib/orders/get-orders-service";
import { ensureOrdersPersistenceReady, ordersErrorResponse } from "@/lib/orders/http";
import type { PatchOrderInput } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const blocked = ensureOrdersPersistenceReady();
  if (blocked) return blocked;
  try {
    const { id } = await ctx.params;
    const actor = resolveOrdersActor(request);
    const order = await getOrdersService().getOrder(id, actor);
    return NextResponse.json({ order, legallyOperational: true });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  const blocked = ensureOrdersPersistenceReady();
  if (blocked) return blocked;
  try {
    const { id } = await ctx.params;
    const actor = resolveOrdersActor(request);
    const body = (await request.json()) as PatchOrderInput;
    const order = await getOrdersService().saveProgress(id, body, actor);
    return NextResponse.json({ order, legallyOperational: true });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  const blocked = ensureOrdersPersistenceReady();
  if (blocked) return blocked;
  try {
    const { id } = await ctx.params;
    const actor = resolveOrdersActor(request);
    const result = await getOrdersService().deleteEmptyDraft(id, actor);
    return NextResponse.json({ ...result, legallyOperational: true });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
