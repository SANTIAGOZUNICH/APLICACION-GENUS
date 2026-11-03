import { NextResponse } from "next/server";
import { isRemitoSchemaReady, remitoSchemaPendingResponse } from "@/lib/db/remito-schema";
import { isDatabaseConfigured } from "@/lib/db/client";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import { createRemitoDraftsFromDeliveries, groupDeliveries, listEligibleDeliveries, previewRemitosFromDeliveries } from "@/lib/remitos/from-deliveries";
import { listDeliveriesOfWork, prepareRemitoFromDelivery } from "@/lib/remitos/delivery-remittance";
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
    // ?workItemId=… → TODAS las entregas del trabajo, una por una, con cajas, remitido y disponible (incluye las ya remitidas por completo).
    const workItemId = new URL(request.url).searchParams.get("workItemId");
    if (workItemId) return NextResponse.json(await listDeliveriesOfWork(workItemId.replace(/^native:/, "")));
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
    const body = (await request.json().catch(() => ({}))) as { action?: string; lineIds?: unknown; lineId?: unknown; quantity?: unknown; packingGroups?: unknown; observations?: unknown; requestId?: unknown };
    const lineIds = Array.isArray(body.lineIds) ? body.lineIds.map(String) : [];
    if (!isDatabaseConfigured()) throw new OrdersValidationError("Los remitos desde entregas requieren la base de datos.");
    if (!(await isRemitoSchemaReady())) return NextResponse.json(remitoSchemaPendingResponse(), { status: 503 });
    // «Preparar remito» de UNA entrega (total o por partes): el servidor valida el saldo dentro de un candado por entrega.
    if (body.action === "prepare") {
      const out = await prepareRemitoFromDelivery(
        { email: actor.email, sector: actor.sector },
        {
          deliveryLineId: String(body.lineId ?? ""),
          quantity: body.quantity === undefined ? undefined : (body.quantity as number | string | null),
          packingGroups: body.packingGroups,
          observations: body.observations == null ? null : String(body.observations),
          requestId: body.requestId == null ? null : String(body.requestId),
        }
      );
      return NextResponse.json(out, { status: out.replayed ? 200 : 201 });
    }
    if (body.action === "preview") return NextResponse.json(await previewRemitosFromDeliveries(lineIds));
    if (body.action === "create") {
      const out = await createRemitoDraftsFromDeliveries({ email: actor.email, sector: actor.sector }, lineIds);
      return NextResponse.json(out, { status: 201 });
    }
    throw new OrdersValidationError("Acción inválida (preview | create | prepare).");
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
