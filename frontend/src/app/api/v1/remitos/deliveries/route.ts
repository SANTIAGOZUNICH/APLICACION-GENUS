import { NextResponse } from "next/server";
import { isRemitoSchemaReady, remitoSchemaPendingResponse } from "@/lib/db/remito-schema";
import { isDatabaseConfigured } from "@/lib/db/client";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import { createRemitoDraftsFromDeliveries, groupDeliveries, listEligibleDeliveries, previewRemitosFromDeliveries } from "@/lib/remitos/from-deliveries";
import { canAccessRemitos, canReadRemitos } from "@/lib/remitos/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Entregas reales pendientes de remito (agrupadas por cliente + fecha). Producción y Administración (solo lectura). */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canReadRemitos(actor.sector)) throw new OrdersForbiddenError("Solo PRODUCCIÓN o ADMINISTRACIÓN pueden consultar Remitos.");
    if (!isDatabaseConfigured()) return NextResponse.json({ deliveries: [], groups: [] });
    if (!(await isRemitoSchemaReady())) return NextResponse.json(remitoSchemaPendingResponse(), { status: 503 });
    const deliveries = await listEligibleDeliveries();
    return NextResponse.json({ deliveries, groups: groupDeliveries(deliveries) });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

/** { action: "preview" | "create", lineIds: string[] } — la vista previa no escribe nada; «create» deja BORRADORES. */
export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canAccessRemitos(actor.sector)) throw new OrdersForbiddenError("Solo PRODUCCIÓN puede hacer remitos.");
    const body = (await request.json().catch(() => ({}))) as { action?: string; lineIds?: unknown };
    const lineIds = Array.isArray(body.lineIds) ? body.lineIds.map(String) : [];
    if (!isDatabaseConfigured()) throw new OrdersValidationError("Los remitos desde entregas requieren la base de datos.");
    if (!(await isRemitoSchemaReady())) return NextResponse.json(remitoSchemaPendingResponse(), { status: 503 });
    if (body.action === "preview") return NextResponse.json(await previewRemitosFromDeliveries(lineIds));
    if (body.action === "create") {
      const out = await createRemitoDraftsFromDeliveries({ email: actor.email, sector: actor.sector }, lineIds);
      return NextResponse.json(out, { status: 201 });
    }
    throw new OrdersValidationError("Acción inválida.");
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
