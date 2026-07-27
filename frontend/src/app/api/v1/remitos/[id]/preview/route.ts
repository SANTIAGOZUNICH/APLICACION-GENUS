import { NextResponse } from "next/server";
import { getRemitoService } from "@/lib/remitos/remito-service";
import { canAccessRemitos } from "@/lib/remitos/types";
import { RemitoSchemaPendingError, remitoSchemaPendingResponse } from "@/lib/db/remito-schema";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function remitosError(err: unknown) {
  if (err instanceof RemitoSchemaPendingError) {
    return NextResponse.json(remitoSchemaPendingResponse(), { status: 503 });
  }
  return ordersErrorResponse(err);
}

/** Vista previa HTML estilo Excel (desde plantilla XLSX real). */
export async function GET(request: Request, ctx: Ctx) {
  try {
    const actor = resolveOrdersActor(request);
    if (!canAccessRemitos(actor.sector)) {
      throw new OrdersForbiddenError("Solo PRODUCCIÓN puede acceder a Remitos.");
    }
    const { id } = await ctx.params;
    const html = await getRemitoService().previewHtml(
      { email: actor.email, sector: actor.sector },
      id
    );
    return NextResponse.json({ html });
  } catch (err) {
    return remitosError(err);
  }
}
