import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersValidationError } from "@/lib/orders/types";
import type { PedidoCellChange } from "@/lib/production-pedidos/cell-edit";
import { getProductionPedidosService, PedidoCellPatchError } from "@/lib/production-pedidos/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH parcial y atómico por celda de Pedidos (solo Producción / superadmin). */
export async function PATCH(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const body = (await request.json().catch(() => null)) as { changes?: PedidoCellChange[] } | null;
    if (!body || !Array.isArray(body.changes)) throw new OrdersValidationError("changes es obligatorio.");
    const result = await getProductionPedidosService().patchCells({ email: actor.email, sector: actor.sector, roleId: actor.roleId }, body.changes);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof PedidoCellPatchError) {
      return NextResponse.json({ ok: false, error: err.message, failures: err.failures }, { status: err.status });
    }
    return ordersErrorResponse(err);
  }
}
