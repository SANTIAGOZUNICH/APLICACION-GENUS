import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { getProductionPedidosService } from "@/lib/production-pedidos/service";
import type { ProductionPedidoInput } from "@/lib/production-pedidos/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const body = (await request.json()) as {
      rows?: ProductionPedidoInput[];
      confirm?: boolean;
    };
    if (!body.confirm) {
      return NextResponse.json(
        { error: "Confirmá la importación (confirm: true)." },
        { status: 400 }
      );
    }
    const result = await getProductionPedidosService().importMany(
      { email: actor.email, sector: actor.sector, roleId: actor.roleId },
      body.rows ?? []
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
