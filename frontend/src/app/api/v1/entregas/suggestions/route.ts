import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { entregasService } from "@/lib/entregas/service";
import { entregasErrorResponse } from "@/lib/entregas/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Entregas pendientes que coinciden con cliente + producto + sector (para «Asignar trabajo»). Solo Producción/Dirección. */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const url = new URL(request.url);
    const suggestions = await entregasService.suggestions(actor, {
      client: url.searchParams.get("client") ?? "",
      product: url.searchParams.get("product") ?? "",
      sector: url.searchParams.get("sector") || null,
    });
    return NextResponse.json({ suggestions });
  } catch (err) {
    return entregasErrorResponse(err);
  }
}
