import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { getOrdersService } from "@/lib/orders/get-orders-service";
import { ensureOrdersPersistenceReady, ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const blocked = ensureOrdersPersistenceReady();
  if (blocked) return blocked;
  try {
    const { id } = await ctx.params;
    const actor = resolveOrdersActor(request);
    const body = (await request.json()) as {
      decision?: "APROBADA" | "RECHAZADA";
      decisionReason?: string;
    };
    if (body.decision !== "APROBADA" && body.decision !== "RECHAZADA") {
      return NextResponse.json(
        { error: "decision debe ser APROBADA o RECHAZADA.", code: "ORDERS_VALIDATION" },
        { status: 400 }
      );
    }
    const result = await getOrdersService().decideProposal(
      id,
      actor,
      body.decision,
      body.decisionReason ?? ""
    );
    return NextResponse.json({ ...result, legallyOperational: true });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
