import { NextResponse } from "next/server";
import {
  AsignacionCellPatchError,
  getAsignacionLotesService,
} from "@/lib/asignacion-lotes/asignacion-lotes-service";
import type { AsignacionCellChange } from "@/lib/asignacion-lotes/cell-edit";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH parcial por celda (grilla tipo Excel). Atómico: o se guardan TODAS
 * las celdas o ninguna. Respuesta de rechazo: { error, failures: [...] }.
 */
export async function PATCH(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const body = (await request.json().catch(() => null)) as {
      actorSectorId?: string;
      changes?: AsignacionCellChange[];
    } | null;
    if (!body || !Array.isArray(body.changes)) {
      throw new OrdersValidationError("changes es obligatorio.");
    }
    if (body.actorSectorId && body.actorSectorId !== actor.sector) {
      throw new OrdersForbiddenError("El sector enviado no coincide con la sesión del actor.");
    }
    const result = await getAsignacionLotesService().patchCells(
      { email: actor.email, sector: actor.sector, displayName: actor.displayName },
      body.changes
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof AsignacionCellPatchError) {
      return NextResponse.json(
        { error: err.message, code: err.code, failures: err.failures },
        { status: err.status }
      );
    }
    return ordersErrorResponse(err);
  }
}
