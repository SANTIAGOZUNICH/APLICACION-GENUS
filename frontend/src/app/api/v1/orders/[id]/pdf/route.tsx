import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { getOrdersService } from "@/lib/orders/get-orders-service";
import { ensureOrdersPersistenceReady, ordersErrorResponse } from "@/lib/orders/http";
import {
  assertBlankSignatures,
  OperationalOrderPdfDocument,
} from "@/lib/orders/pdf-document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const blocked = ensureOrdersPersistenceReady();
  if (blocked) return blocked;
  try {
    const { id } = await ctx.params;
    const actor = resolveOrdersActor(request);
    const order = await getOrdersService().recordDownload(id, actor, "pdf");
    assertBlankSignatures(order);
    const buffer = await renderToBuffer(
      <OperationalOrderPdfDocument order={order} />
    );
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${order.orderNumber}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
