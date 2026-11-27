import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { getProductionPedidosService } from "@/lib/production-pedidos/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Siguiente N° de OP correlativo (vista previa para autocompletar; la reserva real se hace en el alta con `opAuto`). */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const nextOp = await getProductionPedidosService().nextOp({ email: actor.email, sector: actor.sector, roleId: actor.roleId });
    return NextResponse.json({ nextOp }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
