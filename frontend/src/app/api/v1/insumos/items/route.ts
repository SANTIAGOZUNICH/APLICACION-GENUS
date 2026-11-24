import { NextResponse } from "next/server";
import { createInsumoItem, reorderInsumoItems } from "@/lib/insumos/insumos-service";
import { readJson, resolveInsumoActor } from "@/lib/insumos/insumos-http";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersValidationError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Alta de un insumo del catálogo `{ name }`. Solo Administración y Dirección. */
export async function POST(request: Request) {
  try {
    const actor = await resolveInsumoActor(request);
    const body = await readJson<{ name?: unknown }>(request);
    return NextResponse.json({ item: await createInsumoItem(actor, { name: body.name }) }, { status: 201 });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

/** Reordena el catálogo `{ orderedIds: string[] }`. */
export async function PUT(request: Request) {
  try {
    const actor = await resolveInsumoActor(request);
    const body = await readJson<{ orderedIds?: unknown }>(request);
    if (!Array.isArray(body.orderedIds) || body.orderedIds.some((x) => typeof x !== "string")) throw new OrdersValidationError("orderedIds tiene que ser una lista de ids.");
    return NextResponse.json({ items: await reorderInsumoItems(actor, body.orderedIds as string[]) });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
