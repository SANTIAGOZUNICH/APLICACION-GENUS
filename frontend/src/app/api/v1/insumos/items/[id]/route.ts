import { NextResponse } from "next/server";
import { updateInsumoItem } from "@/lib/insumos/insumos-service";
import { readJson, resolveInsumoActor } from "@/lib/insumos/insumos-http";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Edita nombre / alta-baja lógica (`active`) / orden de un insumo. Solo Administración y Dirección. */
export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const actor = await resolveInsumoActor(request);
    const { id } = await ctx.params;
    const body = await readJson<{ name?: unknown; active?: unknown; sortOrder?: unknown }>(request);
    return NextResponse.json({ item: await updateInsumoItem(actor, id, body) });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
