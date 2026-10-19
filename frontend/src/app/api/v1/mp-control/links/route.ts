import { NextResponse } from "next/server";
import { approveMpLink, removeMpLink } from "@/lib/mp-control/weekly-availability-service";
import { canWriteMpControl } from "@/lib/mp-control/types";
import type { MpLinkKind } from "@/lib/mp-control/availability";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: MpLinkKind[] = ["formula_code", "formula_name", "inventory_code"];

/** Confirma (y recuerda) una equivalencia entre una MP de fórmula/otro proveedor y el código maestro del inventario. */
export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canWriteMpControl(actor.sector)) return NextResponse.json({ error: "Solo Materia Prima puede confirmar equivalencias." }, { status: 403 });
    const body = (await request.json().catch(() => ({}))) as { kind?: string; key?: string; masterCode?: string; note?: string };
    if (!KINDS.includes(body.kind as MpLinkKind)) return NextResponse.json({ error: "kind inválido" }, { status: 400 });
    await approveMpLink({ kind: body.kind as MpLinkKind, key: String(body.key ?? ""), masterCode: String(body.masterCode ?? ""), by: actor.email, note: body.note });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && /código maestro|Falta|consigo/.test(err.message)) return NextResponse.json({ error: err.message }, { status: 400 });
    return ordersErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canWriteMpControl(actor.sector)) return NextResponse.json({ error: "Solo Materia Prima puede quitar equivalencias." }, { status: 403 });
    const body = (await request.json().catch(() => ({}))) as { kind?: string; key?: string };
    if (!KINDS.includes(body.kind as MpLinkKind)) return NextResponse.json({ error: "kind inválido" }, { status: 400 });
    await removeMpLink({ kind: body.kind as MpLinkKind, key: String(body.key ?? "") });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
