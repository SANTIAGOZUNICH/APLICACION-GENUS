import { NextResponse } from "next/server";
import { emailActor, emailError } from "@/lib/email-orders/http";
import { getEmailOrdersService } from "@/lib/email-orders/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Acciones sobre un borrador: update | approve | discard | reviewed. Cada una vuelve a validar el permiso (solo Producción) en el servidor. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const actor = await emailActor(request);
    const svc = getEmailOrdersService();
    const body = (await request.json().catch(() => ({}))) as { action?: string; expectedVersion?: number; payload?: unknown; reason?: string; asNew?: boolean };
    switch (body.action) {
      case "update":
        return NextResponse.json({ item: await svc.update(actor, id, { expectedVersion: Number(body.expectedVersion), payload: body.payload }) });
      case "approve":
        return NextResponse.json(await svc.approve(actor, id, { asNew: body.asNew === true }));
      case "discard":
        await svc.discard(actor, id, String(body.reason ?? ""));
        return NextResponse.json({ ok: true });
      case "reviewed":
        await svc.markReviewed(actor, id);
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
    }
  } catch (err) {
    return emailError(err);
  }
}
