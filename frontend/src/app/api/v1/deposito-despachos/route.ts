import { NextResponse } from "next/server";
import { getDespachosService } from "@/lib/despachos/despachos-service";
import type { CreateDespachoInput } from "@/lib/despachos/types";
import { isDatabaseConfigured } from "@/lib/db/client";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersValidationError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const toActor = (a: Awaited<ReturnType<typeof resolveOrdersActor>>) => ({ email: a.email, sector: a.sector, displayName: a.displayName });

/** Listado de entregas a Producción (Depósito carga; Producción y Dirección consultan). */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const items = await getDespachosService().list(toActor(actor));
    return NextResponse.json({ items, persistenceReady: isDatabaseConfigured() });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

/** Alta de una fila (`record`) o de varias (`records`, pegado de Excel; `batchKey` hace seguro el reintento). */
export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const body = (await request.json()) as { record?: CreateDespachoInput; records?: CreateDespachoInput[]; batchKey?: string };
    const svc = getDespachosService();
    if (Array.isArray(body.records)) {
      const results = await svc.createMany(toActor(actor), body.records, body.batchKey);
      return NextResponse.json({ results }, { status: 201 });
    }
    if (!body.record) throw new OrdersValidationError("record es obligatorio.");
    const r = await svc.create(toActor(actor), body.record);
    return NextResponse.json({ record: r.record, created: r.created }, { status: r.created ? 201 : 200 });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
