import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { getOrdersService } from "@/lib/orders/get-orders-service";
import { ensureOrdersPersistenceReady, ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Regulariza el descuento de MP pendiente de una OE ya entregada (una sola vez, idempotente, auditado). */
export async function POST(request: Request, ctx: Ctx) {
  const blocked = ensureOrdersPersistenceReady();
  if (blocked) return blocked;
  try {
    const { id } = await ctx.params;
    const actor = await resolveOrdersActor(request);
    const body = (await request.json().catch(() => ({}))) as {
      rows?: Array<{ rowId?: string; codigoMp?: string; lote?: string; kgReal?: number | null }>;
      allowNegativeMpStock?: boolean;
      negativeMpStockReason?: string;
    };
    const rows = (Array.isArray(body.rows) ? body.rows : [])
      .filter((r) => typeof r?.rowId === "string")
      .map((r) => ({
        rowId: r.rowId as string,
        codigoMp: typeof r.codigoMp === "string" ? r.codigoMp : undefined,
        lote: typeof r.lote === "string" ? r.lote : undefined,
        kgReal: r.kgReal === null ? null : typeof r.kgReal === "number" ? r.kgReal : undefined,
      }));
    const order = await getOrdersService().settleMpConsumption(id, actor, {
      rows,
      allowNegativeMpStock: Boolean(body.allowNegativeMpStock),
      negativeMpStockReason: body.negativeMpStockReason,
    });
    return NextResponse.json({ order });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
