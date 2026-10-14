import { NextResponse } from "next/server";
import { getDashboard } from "@/lib/dashboard/service";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/dashboard?year=&month=&sector=&client=
 * Solo lectura. El sector del actor (sesión, nunca el cliente) decide qué datos salen en el payload:
 * Producción/Dirección ven todo; el resto, agregados de planta SIN nombres de clientes.
 */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const url = new URL(request.url);
    const payload = await getDashboard(
      { email: actor.email, sector: actor.sector },
      {
        year: url.searchParams.get("year"),
        month: url.searchParams.get("month"),
        sector: url.searchParams.get("sector"),
        client: url.searchParams.get("client"),
      }
    );
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
