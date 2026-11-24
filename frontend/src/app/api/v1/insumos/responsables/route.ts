import { NextResponse } from "next/server";
import { createResponsable, reorderResponsables } from "@/lib/insumos/insumos-service";
import { readJson, resolveInsumoActor } from "@/lib/insumos/insumos-http";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersValidationError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Alta de un responsable `{ sector, name }`. Solo Administración y Dirección. */
export async function POST(request: Request) {
  try {
    const actor = await resolveInsumoActor(request);
    const body = await readJson<{ sector?: unknown; name?: unknown }>(request);
    return NextResponse.json({ responsable: await createResponsable(actor, { sector: body.sector, name: body.name }) }, { status: 201 });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

/** Reordena los responsables de un sector `{ sector, orderedIds }`. */
export async function PUT(request: Request) {
  try {
    const actor = await resolveInsumoActor(request);
    const body = await readJson<{ sector?: unknown; orderedIds?: unknown }>(request);
    if (typeof body.sector !== "string" || !Array.isArray(body.orderedIds) || body.orderedIds.some((x) => typeof x !== "string")) throw new OrdersValidationError("Indicá el sector y la lista de ids.");
    return NextResponse.json({ responsables: await reorderResponsables(actor, body.sector, body.orderedIds as string[]) });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
