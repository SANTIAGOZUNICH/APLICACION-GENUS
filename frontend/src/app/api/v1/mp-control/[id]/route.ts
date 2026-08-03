import { NextResponse } from "next/server";
import { getMpControlService } from "@/lib/mp-control/mp-control-service";
import type { MpWeeklyControlLine, MpWeeklyControlStatus } from "@/lib/mp-control/types";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  try {
    const actor = await resolveOrdersActor(request);
    const { id } = await ctx.params;
    const control = await getMpControlService().get(
      { email: actor.email, sector: actor.sector },
      id
    );
    if (!control) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    return NextResponse.json({ control });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const actor = await resolveOrdersActor(request);
    const { id } = await ctx.params;
    const body = (await request.json()) as {
      quantityKg?: number | null;
      client?: string;
      product?: string;
      linkedOeId?: string | null;
      lines?: MpWeeklyControlLine[];
      status?: MpWeeklyControlStatus;
      recalcFromSnapshot?: boolean;
      stockByCodigo?: Record<string, number>;
      lifecycleAction?: "annul" | "archive" | "restore";
      reason?: string;
    };
    const svc = getMpControlService();
    const mpActor = { email: actor.email, sector: actor.sector };
    if (body.lifecycleAction === "annul") {
      const control = await svc.annul(mpActor, id, body.reason ?? "");
      return NextResponse.json({ control });
    }
    if (body.lifecycleAction === "archive") {
      const control = await svc.archive(mpActor, id);
      return NextResponse.json({ control });
    }
    if (body.lifecycleAction === "restore") {
      const control = await svc.restore(mpActor, id);
      return NextResponse.json({ control });
    }
    const control = await svc.update(mpActor, id, body);
    return NextResponse.json({ control });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const actor = await resolveOrdersActor(request);
    const { id } = await ctx.params;
    await getMpControlService().deleteDraft(
      { email: actor.email, sector: actor.sector },
      id
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
