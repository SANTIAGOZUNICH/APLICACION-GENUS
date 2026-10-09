import { NextResponse } from "next/server";
import { getAsignacionLotesService } from "@/lib/asignacion-lotes/asignacion-lotes-service";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set(["KEEP_GENUS", "USE_SHEET", "REVERT_TO_SHEET", "ARCHIVE"]);

/** 0043 — Decide sobre una edición de GENUS en un lote sincronizado (mantener GENUS / usar planilla / volver / archivar). */
export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const body = (await request.json().catch(() => null)) as { actorSectorId?: string; editId?: string; action?: string; expectedVersion?: string; reason?: string } | null;
    if (!body?.editId || !body.action || !ACTIONS.has(body.action) || !body.expectedVersion) {
      throw new OrdersValidationError("editId, action y expectedVersion son obligatorios.");
    }
    if (body.actorSectorId && body.actorSectorId !== actor.sector) throw new OrdersForbiddenError("El sector enviado no coincide con la sesión del actor.");
    const item = await getAsignacionLotesService().resolveLocalEdit(
      { email: actor.email, sector: actor.sector, displayName: actor.displayName },
      { editId: body.editId, action: body.action as "KEEP_GENUS", expectedVersion: body.expectedVersion, reason: body.reason }
    );
    return NextResponse.json({ item });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
