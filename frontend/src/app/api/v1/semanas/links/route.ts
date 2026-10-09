import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersValidationError } from "@/lib/orders/types";
import { linkSemanasTask, unlinkSemanasTask } from "@/lib/semanas-sheet/semanas-sheet-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Vínculo explícito tarea de Semanas ↔ trabajo operativo (0042). Solo Producción. No escribe en la Sheet ni en work_items. */
function errorResponse(err: unknown) {
  const status = (err as { status?: number } | null)?.status;
  if ((status === 409 || status === 503) && err instanceof Error) return NextResponse.json({ ok: false, error: err.message }, { status });
  return ordersErrorResponse(err);
}

/** Vincula (o corrige, con `replace` + motivo) un trabajo con una tarea. */
export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const body = (await request.json().catch(() => null)) as { tabKey?: string; taskKey?: string; workItemId?: string; replace?: { linkId?: string; expectedVersion?: number }; reason?: string } | null;
    if (!body?.tabKey || !body.taskKey || !body.workItemId) throw new OrdersValidationError("tabKey, taskKey y workItemId son obligatorios.");
    const replace = body.replace?.linkId && typeof body.replace.expectedVersion === "number" ? { linkId: String(body.replace.linkId), expectedVersion: body.replace.expectedVersion } : undefined;
    const link = await linkSemanasTask(
      { email: actor.email, sector: actor.sector, displayName: actor.displayName },
      { tabKey: String(body.tabKey), taskKey: String(body.taskKey), workItemId: String(body.workItemId), replace, reason: body.reason ? String(body.reason) : undefined }
    );
    return NextResponse.json({ ok: true, link });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Quita un vínculo (lógico, auditado). Exige versión y motivo. */
export async function DELETE(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const body = (await request.json().catch(() => null)) as { linkId?: string; expectedVersion?: number; reason?: string } | null;
    if (!body?.linkId || typeof body.expectedVersion !== "number") throw new OrdersValidationError("linkId y expectedVersion son obligatorios.");
    await unlinkSemanasTask({ email: actor.email, sector: actor.sector, displayName: actor.displayName }, { linkId: String(body.linkId), expectedVersion: body.expectedVersion, reason: String(body.reason ?? "") });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
