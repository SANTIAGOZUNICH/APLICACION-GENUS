import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { entregasService } from "@/lib/entregas/service";
import { entregasErrorResponse } from "@/lib/entregas/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Auditoría de fechas del Calendario de Entregas (SOLO LECTURA: no escribe nada). Solo Producción.
 * Por cada causa de fecha incorrecta o contradictoria: cantidad de casos y ejemplos para revisar.
 */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    return NextResponse.json({ audit: await entregasService.dateAudit(actor) });
  } catch (err) {
    return entregasErrorResponse(err);
  }
}
