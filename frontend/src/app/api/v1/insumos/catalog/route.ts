import { NextResponse } from "next/server";
import { getCatalog } from "@/lib/insumos/insumos-service";
import { resolveInsumoActor } from "@/lib/insumos/insumos-http";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Catálogo según quien consulta: sectores operativos → insumos activos + responsables de SU sector; Administración/Dirección → todo (`?all=1`). */
export async function GET(request: Request) {
  try {
    const actor = await resolveInsumoActor(request);
    const all = new URL(request.url).searchParams.get("all") === "1";
    return NextResponse.json(await getCatalog(actor, { all }), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
