import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { getProductionPedidosService } from "@/lib/production-pedidos/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Clientes del Portal de Clientes (ID + nombre comercial + alias) para el selector del formulario de pedidos. */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const clients = await getProductionPedidosService().listPortalClients({ email: actor.email, sector: actor.sector, roleId: actor.roleId });
    return NextResponse.json({ clients }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
