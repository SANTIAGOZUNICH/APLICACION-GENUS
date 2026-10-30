import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { getProductionPedidosService } from "@/lib/production-pedidos/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pedidos para DEPÓSITO — SOLO LECTURA. Mismos pedidos que ve Producción, reducidos a producto, cliente y cantidad pedida.
 * Esta ruta no define POST/PATCH/DELETE: cualquier intento de escritura responde 405, y las rutas de escritura de Pedidos
 * (`/api/v1/production-pedidos*`) siguen rechazando a Depósito con 403 en el servidor.
 */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const result = await getProductionPedidosService().listForDeposito({ email: actor.email, sector: actor.sector, roleId: actor.roleId });
    return NextResponse.json({ items: result.items, schemaPending: result.schemaPending }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
