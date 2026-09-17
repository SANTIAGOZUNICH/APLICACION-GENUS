import { NextResponse } from "next/server";
import { getAsignacionLoteSourcesService } from "@/lib/asignacion-lotes/asignacion-lote-sources-service";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersValidationError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toActor(actor: Awaited<ReturnType<typeof resolveOrdersActor>>) {
  return { email: actor.email, sector: actor.sector, displayName: actor.displayName };
}

/**
 * [ PROBAR CONEXIÓN ] — antes de conectar. Nunca persiste nada, solo lee
 * metadata/headers reales de la Sheet para mostrar los 4 checks pedidos:
 * accesible / hoja encontrada / encabezados reconocidos / filas detectadas.
 */
export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const body = (await request.json()) as { spreadsheetUrlOrId?: string; sheetTab?: string };
    if (!body.spreadsheetUrlOrId) {
      throw new OrdersValidationError("spreadsheetUrlOrId es obligatorio.");
    }
    const result = await getAsignacionLoteSourcesService().testConnection(
      toActor(actor),
      body.spreadsheetUrlOrId,
      body.sheetTab
    );
    return NextResponse.json(result);
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
