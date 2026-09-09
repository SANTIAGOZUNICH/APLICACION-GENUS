import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { getOrdersService } from "@/lib/orders/get-orders-service";
import { ensureOrdersPersistenceReady, ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Elimina (soft-delete/tombstone) una OA. El RBAC de UI solo oculta el
 * botón — la autoridad real es OrdersService.deleteOa(), que revalida
 * sector, motivo obligatorio y relaciones activas (trabajo/entrega/
 * decisión de Calidad) del lado del servidor.
 */
export async function POST(request: Request, ctx: Ctx) {
  const blocked = ensureOrdersPersistenceReady();
  if (blocked) return blocked;
  try {
    const { id } = await ctx.params;
    const actor = await resolveOrdersActor(request);
    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const order = await getOrdersService().deleteOa(id, actor, body.reason ?? "");
    return NextResponse.json({ order, legallyOperational: true });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
