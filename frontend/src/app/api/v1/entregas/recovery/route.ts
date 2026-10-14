import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { entregasService } from "@/lib/entregas/service";
import { entregasErrorResponse } from "@/lib/entregas/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Diagnóstico de solo lectura: cuántas entregas históricas y futuras recupera solo el calendario a partir de los trabajos y
 * cuántos trabajos quedan fuera (sin fecha real / sin fecha de entrega / cancelados). `stats` es null para Envasado (ve recortado).
 */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const stats = await entregasService.recoveryStats(actor);
    return NextResponse.json({ stats });
  } catch (err) {
    return entregasErrorResponse(err);
  }
}
