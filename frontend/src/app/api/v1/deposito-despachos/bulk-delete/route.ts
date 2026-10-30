import { NextResponse } from "next/server";
import { getDespachosService } from "@/lib/despachos/despachos-service";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Eliminación múltiple (baja lógica con auditoría). `ids` o `scope: "all"`. */
export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const body = (await request.json().catch(() => ({}))) as { ids?: unknown; scope?: string };
    const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === "string") : [];
    const result = await getDespachosService().bulkDelete(
      { email: actor.email, sector: actor.sector, displayName: actor.displayName },
      { ids, all: body.scope === "all" }
    );
    return NextResponse.json(result);
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
