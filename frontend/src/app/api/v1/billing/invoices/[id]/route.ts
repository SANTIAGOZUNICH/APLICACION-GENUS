import { NextResponse } from "next/server";
import { withBillingActor, noStore } from "@/lib/billing/api";
import { annulInvoice } from "@/lib/billing/billing-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Anula la factura registrada (motivo obligatorio). No se borra: queda en el historial. */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withBillingActor(request, async (actor) => {
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const result = await annulInvoice(actor, id, String(body.reason ?? ""));
    return NextResponse.json(result, { headers: noStore });
  });
}
