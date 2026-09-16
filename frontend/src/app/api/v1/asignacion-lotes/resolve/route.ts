import { NextResponse } from "next/server";
import { getAsignacionLotesService } from "@/lib/asignacion-lotes/asignacion-lotes-service";
import { resolveAsignacionLoteForWorkItem } from "@/lib/asignacion-lotes/resolve-for-work-item";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resolución de Lote/VTO para Asignar trabajo — reusa el mismo RBAC y
 * listado de Asignación de Lotes ya expuestos por GET /api/v1/asignacion-lotes
 * (Calidad/Producción/Codificado); no crea un permiso nuevo. Solo lectura
 * — la confirmación real de la asignación siempre relee esto mismo
 * server-side en assignWorkItemDurable, este endpoint es exclusivamente
 * para la preview del diálogo.
 */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const url = new URL(request.url);
    const cliente = url.searchParams.get("cliente")?.trim() ?? "";
    const producto = url.searchParams.get("producto")?.trim() ?? "";
    if (!cliente || !producto) {
      return NextResponse.json({ status: "none" });
    }

    const items = await getAsignacionLotesService().list(
      { email: actor.email, sector: actor.sector, displayName: actor.displayName },
      { includeArchived: false }
    );
    const resolution = resolveAsignacionLoteForWorkItem(items, { cliente, producto });
    return NextResponse.json(resolution);
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
