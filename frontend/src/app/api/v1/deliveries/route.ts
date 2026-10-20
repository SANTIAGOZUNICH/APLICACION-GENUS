import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db/client";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import { AuthUnauthorizedError } from "@/lib/auth/types";
import {
  listDeliveriesDurable,
  listDeliveryLinesDurable,
  listDeliveryLinesForDeliveriesDurable,
  nativeIdFromItemId,
  toClientDeliveryRecord,
} from "@/lib/planning/work-item-progress-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Entregados — lectura desde Neon (work_item_deliveries). Reemplaza
 * listActiveDeliveries/listArchivedDeliveries (localStorage) del adapter
 * legacy; el cliente sigue separando activas/archivadas/eliminadas
 * filtrando este mismo listado, igual que antes.
 */
export async function GET(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ deliveries: [] });
  }

  try {
    await resolveOrdersActor(request);
  } catch (err) {
    if (err instanceof AuthUnauthorizedError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 401 });
    }
    if (err instanceof OrdersForbiddenError || err instanceof OrdersValidationError) {
      return NextResponse.json(
        { error: err.message, code: "ACTOR_FORBIDDEN" },
        { status: err instanceof OrdersForbiddenError ? 403 : 400 }
      );
    }
    throw err;
  }

  try {
    // ?workItemId=native:<uuid> → historial de entregas (parciales) de ese trabajo.
    const workItemParam = new URL(request.url).searchParams.get("workItemId");
    if (workItemParam) {
      const nativeId = nativeIdFromItemId(workItemParam) ?? workItemParam;
      return NextResponse.json({ lines: await listDeliveryLinesDurable(nativeId) });
    }
    const rows = await listDeliveriesDurable({ includeDeleted: false });
    // Cajas REALES de cada entrega (renglones de entrega): permanentes, no dependen de la pantalla de remitos.
    const deliveryLines = await listDeliveryLinesForDeliveriesDurable(rows.map((r) => r.id)).catch(() => []);
    return NextResponse.json({ deliveries: rows.map(toClientDeliveryRecord), deliveryLines });
  } catch (error) {
    return NextResponse.json(
      {
        deliveries: [],
        error: error instanceof Error ? error.message : "Error al cargar entregas.",
        code: "DELIVERIES_FAILED",
      },
      { status: 502 }
    );
  }
}
