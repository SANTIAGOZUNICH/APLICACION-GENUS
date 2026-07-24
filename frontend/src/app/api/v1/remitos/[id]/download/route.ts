import { NextResponse } from "next/server";
import { getRemitoService } from "@/lib/remitos/remito-service";
import { canAccessRemitos } from "@/lib/remitos/types";
import { RemitoSchemaPendingError, remitoSchemaPendingResponse } from "@/lib/db/remito-schema";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function remitosError(err: unknown) {
  if (err instanceof RemitoSchemaPendingError) {
    return NextResponse.json(remitoSchemaPendingResponse(), { status: 503 });
  }
  return ordersErrorResponse(err);
}

export async function GET(request: Request, ctx: Ctx) {
  try {
    const actor = resolveOrdersActor(request);
    if (!canAccessRemitos(actor.sector)) {
      throw new OrdersForbiddenError("Solo PRODUCCIÓN puede acceder a Remitos.");
    }
    const { id } = await ctx.params;
    const url = new URL(request.url);
    const format = (url.searchParams.get("format") ?? "pdf").toLowerCase();
    if (format !== "pdf" && format !== "xlsx") {
      throw new OrdersValidationError("format debe ser pdf|xlsx");
    }
    const customName = url.searchParams.get("filename");
    const result = await getRemitoService().download(
      { email: actor.email, sector: actor.sector },
      id,
      format
    );
    const fileName = customName?.trim() || result.fileName;
    const headers = new Headers();
    headers.set("Content-Type", result.mimeType);
    headers.set(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(fileName)}"`
    );
    headers.set("Cache-Control", "private, no-store");
    return new NextResponse(new Uint8Array(result.bytes), { status: 200, headers });
  } catch (err) {
    return remitosError(err);
  }
}
