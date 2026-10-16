import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { entregasService } from "@/lib/entregas/service";
import { entregasErrorResponse } from "@/lib/entregas/http";
import { OrdersValidationError } from "@/lib/orders/types";
import type { DeliveryInput } from "@/lib/entregas/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Entregas programadas entre `from` y `to` (la grilla del mes). Todos los sectores con acceso ven el calendario completo; solo Producción/Dirección modifican. */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const url = new URL(request.url);
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    // includeHidden=1: Producción ve también las apariciones «Desde trabajo» que quitó (para restaurarlas).
    const deliveries = await entregasService.list(actor, { from, to }, { includeHidden: url.searchParams.get("includeHidden") === "1" });
    return NextResponse.json({ deliveries });
  } catch (err) {
    return entregasErrorResponse(err);
  }
}

/** Alta de una entrega programada (solo Producción/Dirección). */
export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const body = (await request.json().catch(() => null)) as DeliveryInput | null;
    if (!body || typeof body !== "object") throw new OrdersValidationError("Datos de la entrega inválidos.");
    const delivery = await entregasService.create(actor, body);
    return NextResponse.json({ delivery }, { status: 201 });
  } catch (err) {
    return entregasErrorResponse(err);
  }
}
