import { NextResponse } from "next/server";
import { getAsignacionLotesService } from "@/lib/asignacion-lotes/asignacion-lotes-service";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function toActor(actor: ReturnType<typeof resolveOrdersActor>) {
  return {
    email: actor.email,
    sector: actor.sector,
    displayName: actor.displayName,
  };
}

function assertBodyActorSector(body: { actorSectorId?: string }, actorSector: string): void {
  if (body.actorSectorId && body.actorSectorId !== actorSector) {
    throw new OrdersForbiddenError("El sector enviado no coincide con la sesión del actor.");
  }
}

export async function GET(request: Request, ctx: Ctx) {
  try {
    const actor = resolveOrdersActor(request);
    const { id } = await ctx.params;
    const item = getAsignacionLotesService().get(toActor(actor), id);
    if (!item) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    return NextResponse.json({ item });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const actor = resolveOrdersActor(request);
    const { id } = await ctx.params;
    const body = (await request.json()) as {
      lifecycleAction?: "archive" | "restore";
      actorSectorId?: string;
    };

    assertBodyActorSector(body, actor.sector);

    const svc = getAsignacionLotesService();
    const mpActor = toActor(actor);

    if (body.lifecycleAction === "archive") {
      const item = svc.archive(mpActor, id);
      return NextResponse.json({ item });
    }
    if (body.lifecycleAction === "restore") {
      const item = svc.restore(mpActor, id);
      return NextResponse.json({ item });
    }

    return NextResponse.json({ error: "lifecycleAction inválida" }, { status: 400 });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const actor = resolveOrdersActor(request);
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as { actorSectorId?: string };
    assertBodyActorSector(body, actor.sector);

    getAsignacionLotesService().delete(toActor(actor), id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
