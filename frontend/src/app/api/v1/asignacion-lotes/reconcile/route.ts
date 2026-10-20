import { NextResponse } from "next/server";
import { reconcileLoteLinks } from "@/lib/asignacion-lotes/lote-link";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reconciliación segura de trabajos existentes con Asignación de Lotes. Solo Producción. Por defecto
 * es simulación (dryRun): informa qué se vincularía; con {"apply": true} vincula SOLO coincidencias
 * únicas, deja ambiguos/sin coincidencia pendientes y no toca trabajos cerrados ni valores propios.
 */
export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (actor.sector !== "PRODUCCION") {
      throw new OrdersForbiddenError("Solo Producción puede reconciliar lotes.");
    }
    const body = (await request.json().catch(() => ({}))) as { apply?: boolean };
    const result = await reconcileLoteLinks({
      actorEmail: actor.email,
      actorSector: actor.sector,
      dryRun: body.apply !== true,
    });
    return NextResponse.json({ dryRun: body.apply !== true, ...result });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
