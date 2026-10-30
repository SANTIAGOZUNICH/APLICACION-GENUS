import { NextResponse } from "next/server";
import { getDespachosService } from "@/lib/despachos/despachos-service";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const toActor = (a: Awaited<ReturnType<typeof resolveOrdersActor>>) => ({ email: a.email, sector: a.sector, displayName: a.displayName });

/** Historial de cambios del despacho (`?history=1`) o el registro. */
export async function GET(request: Request, ctx: Ctx) {
  try {
    const actor = await resolveOrdersActor(request);
    const { id } = await ctx.params;
    const svc = getDespachosService();
    if (new URL(request.url).searchParams.get("history") === "1") {
      return NextResponse.json({ history: await svc.listAudit(toActor(actor), id) });
    }
    const record = await svc.get(toActor(actor), id);
    if (!record) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    return NextResponse.json({ record });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const actor = await resolveOrdersActor(request);
    const { id } = await ctx.params;
    const deleted = await getDespachosService().delete(toActor(actor), id);
    return NextResponse.json({ deleted });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
