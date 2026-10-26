import { NextResponse } from "next/server";
import { approveNameAlias, listConfirmedAliases, removeNameAlias, suggestAliases } from "@/lib/mp-control/weekly-availability-service";
import { canReadMpControl, canWriteMpControl } from "@/lib/mp-control/types";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Coincidencias sugeridas (candidatos reales del Stock MP) y equivalencias ya confirmadas para una MP de la fórmula. Solo lectura. */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canReadMpControl(actor.sector)) return NextResponse.json({ error: "Sin permiso para ver el Control de MP." }, { status: 403 });
    const url = new URL(request.url);
    const name = String(url.searchParams.get("name") ?? "").trim();
    if (!name) return NextResponse.json({ error: "Falta la materia prima." }, { status: 400 });
    const [suggestions, confirmed] = await Promise.all([suggestAliases({ name, code: url.searchParams.get("code") ?? "" }), listConfirmedAliases(name)]);
    return NextResponse.json({ suggestions, confirmed });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

/** Incluye (una sola vez, a nivel de materia prima) otra descripción del Stock MP como la misma MP de la fórmula. */
export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canWriteMpControl(actor.sector)) return NextResponse.json({ error: "Solo Materia Prima puede confirmar equivalencias." }, { status: 403 });
    const body = (await request.json().catch(() => ({}))) as { formulaName?: string; stockName?: string; original?: string; code?: string };
    await approveNameAlias({ formulaName: String(body.formulaName ?? ""), stockName: String(body.stockName ?? ""), by: actor.email, original: body.original, code: body.code });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && /Falta|no existe|No se puede/.test(err.message)) return NextResponse.json({ error: err.message }, { status: 400 });
    return ordersErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canWriteMpControl(actor.sector)) return NextResponse.json({ error: "Solo Materia Prima puede quitar equivalencias." }, { status: 403 });
    const body = (await request.json().catch(() => ({}))) as { formulaName?: string; stockName?: string };
    await removeNameAlias({ formulaName: String(body.formulaName ?? ""), stockName: String(body.stockName ?? ""), by: actor.email });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
