import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { getOrdersService } from "@/lib/orders/get-orders-service";
import { ensureOrdersPersistenceReady, ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** «Fórmula pendiente de verificación» de una OE: diferencias fila por fila contra la fórmula aprobada (solo lectura). */
export async function GET(request: Request, ctx: Ctx) {
  const blocked = ensureOrdersPersistenceReady();
  if (blocked) return blocked;
  try {
    const { id } = await ctx.params;
    const actor = await resolveOrdersActor(request);
    return NextResponse.json({ check: await getOrdersService().getFormulaCheck(id, actor) });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

/** Producción/Dirección verifican (o revocan) la fórmula de la OE. No modifica porcentajes ni consumos. */
export async function POST(request: Request, ctx: Ctx) {
  const blocked = ensureOrdersPersistenceReady();
  if (blocked) return blocked;
  try {
    const { id } = await ctx.params;
    const actor = await resolveOrdersActor(request);
    const body = (await request.json()) as { action?: "verify" | "revoke"; note?: string };
    const res = await getOrdersService().verifyFormula(id, actor, { action: body.action === "revoke" ? "revoke" : "verify", note: body.note });
    return NextResponse.json({ order: res.order, check: res.check });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
