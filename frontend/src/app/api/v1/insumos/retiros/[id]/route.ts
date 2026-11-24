import { NextResponse } from "next/server";
import { anularRetiro, correctRetiro, listRetiroEvents } from "@/lib/insumos/insumos-service";
import { readJson, resolveInsumoActor } from "@/lib/insumos/insumos-http";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersValidationError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Auditoría del retiro (eventos inmutables). Solo Administración y Dirección. */
export async function GET(request: Request, ctx: Ctx) {
  try {
    const actor = await resolveInsumoActor(request);
    const { id } = await ctx.params;
    return NextResponse.json({ events: await listRetiroEvents(actor, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

/** `{ action: "corregir", motivo, responsableId?, lines? }` o `{ action: "anular", motivo }`. Solo Administración y Dirección. */
export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const actor = await resolveInsumoActor(request);
    const { id } = await ctx.params;
    const body = await readJson<{ action?: string; motivo?: unknown; responsableId?: string; lines?: unknown }>(request);
    if (body.action === "anular") return NextResponse.json({ retiro: await anularRetiro(actor, id, body.motivo) });
    if (body.action === "corregir") return NextResponse.json({ retiro: await correctRetiro(actor, id, { motivo: body.motivo, responsableId: body.responsableId, lines: body.lines }) });
    throw new OrdersValidationError("action tiene que ser «corregir» o «anular».");
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
