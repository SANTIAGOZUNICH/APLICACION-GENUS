import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { canOrderAction } from "@/lib/orders/rbac";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError } from "@/lib/orders/types";
import type { MpCatalogLot } from "@/lib/orders/oe-mp-consumption";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Catálogo de Stock MP para completar la OE: CÓDIGO MP y lotes existentes (con sus kg), solo lectura.
 * Lo usan quienes ven OE (Elaboración no tiene acceso al módulo de inventario completo).
 */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canOrderAction("OE", "view", actor.sector)) throw new OrdersForbiddenError("No tenés permiso para ver el catálogo de MP.");
    const { listMpCatalogForOe } = await import("@/lib/orders/mp-catalog");
    const lots: MpCatalogLot[] = await listMpCatalogForOe();
    return NextResponse.json({ lots });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
