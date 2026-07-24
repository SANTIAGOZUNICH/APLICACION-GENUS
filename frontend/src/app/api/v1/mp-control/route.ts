import { NextResponse } from "next/server";
import { getMpControlService } from "@/lib/mp-control/mp-control-service";
import type { MpFormulaSnapshot } from "@/lib/mp-control/types";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    const controls = await getMpControlService().list({
      email: actor.email,
      sector: actor.sector,
    });
    return NextResponse.json({ controls });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    const body = (await request.json()) as {
      client?: string;
      product?: string;
      quantityKg?: number | null;
      linkedOeId?: string | null;
      snapshot?: MpFormulaSnapshot;
      stockByCodigo?: Record<string, number>;
    };
    if (!body.snapshot) {
      return NextResponse.json({ error: "snapshot obligatorio" }, { status: 400 });
    }
    const control = await getMpControlService().create(
      { email: actor.email, sector: actor.sector },
      {
        client: String(body.client ?? body.snapshot.client ?? ""),
        product: String(body.product ?? body.snapshot.product ?? ""),
        quantityKg: body.quantityKg ?? null,
        linkedOeId: body.linkedOeId ?? null,
        snapshot: body.snapshot,
        stockByCodigo: body.stockByCodigo,
      }
    );
    return NextResponse.json({ control }, { status: 201 });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
