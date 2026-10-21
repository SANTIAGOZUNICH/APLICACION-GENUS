import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { getOrdersService } from "@/lib/orders/get-orders-service";
import { ensureOrdersPersistenceReady, ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Completa DESPUÉS los datos secundarios pendientes de una OE ya completada (no reabre la OE ni mueve stock). */
export async function POST(request: Request, ctx: Ctx) {
  const blocked = ensureOrdersPersistenceReady();
  if (blocked) return blocked;
  try {
    const { id } = await ctx.params;
    const actor = await resolveOrdersActor(request);
    const body = (await request.json().catch(() => ({}))) as { date?: string; fechaFin?: string; cantidadObtenida?: number | null; client?: string; quantityKg?: number | null; lot?: string };
    const order = await getOrdersService().completePendingFields(id, actor, {
      date: typeof body.date === "string" ? body.date : undefined,
      fechaFin: typeof body.fechaFin === "string" ? body.fechaFin : undefined,
      cantidadObtenida: typeof body.cantidadObtenida === "number" ? body.cantidadObtenida : undefined,
      client: typeof body.client === "string" ? body.client : undefined,
      quantityKg: typeof body.quantityKg === "number" ? body.quantityKg : undefined,
      lot: typeof body.lot === "string" ? body.lot : undefined,
    });
    return NextResponse.json({ order });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
