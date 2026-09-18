import { NextResponse } from "next/server";
import { previewImport } from "@/lib/asignacion-lotes/asignacion-lotes-sync-service";
import { canConfigureAsignacionLoteSources } from "@/features/os/operational/lib/asignacion-lote-sources-rbac";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vista previa de importación antes de conectar (o antes de un sync
 * manual) — nunca persiste nada. Ver ImportPreviewResult.
 */
export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canConfigureAsignacionLoteSources(actor.sector)) {
      throw new OrdersForbiddenError(
        "Ver la vista previa de importación está habilitado solo para Producción/Dirección."
      );
    }
    const body = (await request.json()) as { spreadsheetUrlOrId?: string; sheetTab?: string | null };
    if (!body.spreadsheetUrlOrId) {
      throw new OrdersValidationError("spreadsheetUrlOrId es obligatorio.");
    }
    const result = await previewImport(body.spreadsheetUrlOrId, body.sheetTab);
    return NextResponse.json(result);
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
