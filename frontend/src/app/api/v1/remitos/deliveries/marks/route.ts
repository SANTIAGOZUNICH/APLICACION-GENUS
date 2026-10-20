import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db/client";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import { listMarkedDeliveries, markDeliveries, restoreDeliveries } from "@/lib/remitos/delivery-marks";
import { canAccessRemitos, canReadRemitos } from "@/lib/remitos/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Entregas quitadas de pendientes o marcadas como «remito ya creado» (activas). */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canReadRemitos(actor.sector)) throw new OrdersForbiddenError("Solo PRODUCCIÓN o ADMINISTRACIÓN pueden consultar Remitos.");
    if (!isDatabaseConfigured()) return NextResponse.json({ marked: [] });
    return NextResponse.json({ marked: await listMarkedDeliveries() });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

/** { action: "exclude" | "mark_created" | "restore", lineIds, externalRemitoNumber?, externalRemitoDate?, notes? } — solo Producción. */
export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canAccessRemitos(actor.sector)) throw new OrdersForbiddenError("Solo PRODUCCIÓN puede gestionar los remitos de las entregas.");
    if (!isDatabaseConfigured()) throw new OrdersValidationError("Requiere la base de datos.");
    const body = (await request.json().catch(() => ({}))) as {
      action?: string; lineIds?: unknown; externalRemitoNumber?: unknown; externalRemitoDate?: unknown; notes?: unknown;
    };
    const lineIds = Array.isArray(body.lineIds) ? body.lineIds.map(String) : [];
    if (body.action === "restore") return NextResponse.json(await restoreDeliveries({ email: actor.email }, lineIds));
    if (body.action === "exclude" || body.action === "mark_created") {
      return NextResponse.json(
        await markDeliveries({ email: actor.email }, {
          lineIds,
          mark: body.action === "exclude" ? "EXCLUIDA" : "REMITO_EXTERNO",
          externalRemitoNumber: typeof body.externalRemitoNumber === "string" ? body.externalRemitoNumber : undefined,
          externalRemitoDate: typeof body.externalRemitoDate === "string" ? body.externalRemitoDate : undefined,
          notes: typeof body.notes === "string" ? body.notes : undefined,
        })
      );
    }
    throw new OrdersValidationError("Acción inválida.");
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
