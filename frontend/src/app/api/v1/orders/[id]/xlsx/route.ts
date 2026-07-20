import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { buildOeXlsxBuffer } from "@/lib/orders/export-oe-xlsx";
import { getOrdersService } from "@/lib/orders/get-orders-service";
import { ensureOrdersPersistenceReady, ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const blocked = ensureOrdersPersistenceReady();
  if (blocked) return blocked;
  try {
    const { id } = await ctx.params;
    const actor = resolveOrdersActor(request);
    const order = await getOrdersService().recordDownload(id, actor, "xlsx");
    if (order.type !== "OE") {
      return NextResponse.json(
        { error: "Solo OE se descarga como .xlsx.", code: "ORDERS_VALIDATION" },
        { status: 400 }
      );
    }
    const buffer = await buildOeXlsxBuffer(order);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${order.orderNumber}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
