import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import { canEditSemanas, isSemanasTabKey, loadSemanasView } from "@/lib/semanas-sheet/semanas-sheet-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lee en vivo una pestaña de SEMANAS 2026 y devuelve su modelo (celdas + protección). Solo Producción. */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (actor.sector !== "PRODUCCION") throw new OrdersForbiddenError("Semanas está habilitado para Producción.");
    const tab = new URL(request.url).searchParams.get("tab");
    if (!isSemanasTabKey(tab)) throw new OrdersValidationError("tab inválida (ELABORACION, ACONDICIONAMIENTO, CDIA, ENTREGAS).");
    const view = await loadSemanasView(tab);
    return NextResponse.json({ ...view, canEdit: canEditSemanas(actor.sector) && view.writable });
  } catch (err) {
    if (err instanceof Error && !("status" in err)) {
      return NextResponse.json({ error: `No se pudo leer la planilla: ${err.message}` }, { status: 502 });
    }
    return ordersErrorResponse(err);
  }
}
