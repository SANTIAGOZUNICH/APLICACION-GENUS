import { NextResponse } from "next/server";
import { getAsignacionLoteSourcesService } from "@/lib/asignacion-lotes/asignacion-lote-sources-service";
import type { AsignacionLoteSourceInput } from "@/lib/asignacion-lotes/source-types";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersValidationError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toActor(actor: Awaited<ReturnType<typeof resolveOrdersActor>>) {
  return { email: actor.email, sector: actor.sector, displayName: actor.displayName };
}

/** Lista fuentes configuradas — solo Producción/Dirección (config de sync). */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const sources = await getAsignacionLoteSourcesService().list(toActor(actor));
    return NextResponse.json({ sources });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

/** Conectar una planilla nueva — nunca requiere deploy. */
export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const body = (await request.json()) as Partial<AsignacionLoteSourceInput>;
    if (!body.name || !body.spreadsheetUrlOrId) {
      throw new OrdersValidationError("name y spreadsheetUrlOrId son obligatorios.");
    }
    const source = await getAsignacionLoteSourcesService().create(toActor(actor), {
      name: body.name,
      period: body.period ?? "",
      spreadsheetUrlOrId: body.spreadsheetUrlOrId,
      sheetTab: body.sheetTab,
      enabled: body.enabled,
      priority: body.priority,
    });
    return NextResponse.json({ source }, { status: 201 });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
