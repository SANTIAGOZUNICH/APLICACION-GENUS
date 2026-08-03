import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { getProductionPedidosService } from "@/lib/production-pedidos/service";
import type { ProductionPedidoInput } from "@/lib/production-pedidos/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const actor = await resolveOrdersActor(request);
    const { id } = await ctx.params;
    const body = (await request.json()) as ProductionPedidoInput;
    const item = await getProductionPedidosService().update(
      { email: actor.email, sector: actor.sector, roleId: actor.roleId },
      id,
      body
    );
    return NextResponse.json({ item });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const actor = await resolveOrdersActor(request);
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const item = await getProductionPedidosService().remove(
      { email: actor.email, sector: actor.sector, roleId: actor.roleId },
      id,
      String(body.reason ?? "")
    );
    return NextResponse.json({ item });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
