import { NextResponse } from "next/server";
import { approveNameAlias, removeNameAlias } from "@/lib/mp-control/weekly-availability-service";
import { canWriteMpControl } from "@/lib/mp-control/types";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Incluye (una sola vez, a nivel de materia prima) otra descripción del Stock MP como la misma MP de la fórmula. */
export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canWriteMpControl(actor.sector)) return NextResponse.json({ error: "Solo Materia Prima puede confirmar equivalencias." }, { status: 403 });
    const body = (await request.json().catch(() => ({}))) as { formulaName?: string; stockName?: string };
    await approveNameAlias({ formulaName: String(body.formulaName ?? ""), stockName: String(body.stockName ?? ""), by: actor.email });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && /Falta|no existe/.test(err.message)) return NextResponse.json({ error: err.message }, { status: 400 });
    return ordersErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canWriteMpControl(actor.sector)) return NextResponse.json({ error: "Solo Materia Prima puede quitar equivalencias." }, { status: 403 });
    const body = (await request.json().catch(() => ({}))) as { formulaName?: string; stockName?: string };
    await removeNameAlias({ formulaName: String(body.formulaName ?? ""), stockName: String(body.stockName ?? "") });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
