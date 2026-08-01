import { NextResponse } from "next/server";
import { getAvisosService } from "@/lib/avisos/avisos-service";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const actor = await resolveOrdersActor(request);
    const { id } = await ctx.params;
    const body = (await request.json()) as { action?: string };
    const svc = getAvisosService();
    const a = { email: actor.email, sector: actor.sector };
    if (body.action === "read") {
      const message = await svc.markRead(a, id);
      if (!message) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
      return NextResponse.json({ message });
    }
    if (body.action === "archive") {
      const message = await svc.archive(a, id);
      if (!message) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
      return NextResponse.json({ message });
    }
    if (body.action === "restore") {
      const message = await svc.restore(a, id);
      if (!message) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
      return NextResponse.json({ message });
    }
    return NextResponse.json({ error: "action inválida" }, { status: 400 });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
