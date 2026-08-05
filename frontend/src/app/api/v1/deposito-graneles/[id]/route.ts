import { NextResponse } from "next/server";
import { getGranelesService } from "@/lib/graneles/graneles-service";
import type { UpdateGranelPatch } from "@/lib/graneles/types";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function toActor(actor: Awaited<ReturnType<typeof resolveOrdersActor>>) {
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
    const actor = await resolveOrdersActor(request);
    const { id } = await ctx.params;
    const record = await getGranelesService().get(toActor(actor), id);
    if (!record) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    return NextResponse.json({ record });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const actor = await resolveOrdersActor(request);
    const { id } = await ctx.params;
    const body = (await request.json()) as {
      actorSectorId?: string;
      patch?: UpdateGranelPatch;
      reason?: string;
    };
    assertBodyActorSector(body, actor.sector);

    const record = await getGranelesService().update(toActor(actor), id, {
      patch: body.patch ?? {},
      reason: body.reason,
    });
    return NextResponse.json({ record });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const actor = await resolveOrdersActor(request);
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as {
      actorSectorId?: string;
      reason?: string;
    };
    assertBodyActorSector(body, actor.sector);

    const result = await getGranelesService().deleteOrAnnul(toActor(actor), id, body.reason);
    return NextResponse.json({ ok: true, action: result.action, record: result.record });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
