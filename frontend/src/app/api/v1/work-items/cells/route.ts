import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import type { WorkItemCellChange } from "@/lib/planning/work-item-cell-edit";
import { applyWorkItemCellChanges } from "@/lib/planning/work-item-cells-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Edición por celda de trabajos (Producción): resultado POR CELDA; `ok` solo si todas quedaron persistidas. */
export async function PATCH(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const body = (await request.json().catch(() => null)) as { actorSectorId?: string; changes?: WorkItemCellChange[] } | null;
    if (!body || !Array.isArray(body.changes)) throw new OrdersValidationError("changes es obligatorio.");
    if (body.actorSectorId && body.actorSectorId !== actor.sector) {
      throw new OrdersForbiddenError("El sector enviado no coincide con la sesión del actor.");
    }
    const { results, ok } = await applyWorkItemCellChanges(
      { email: actor.email, sector: actor.sector, displayName: actor.displayName },
      body.changes
    );
    const codes = new Set(results.flatMap((r) => (r.ok ? [] : [r.code])));
    const status = ok ? 200 : codes.has("CONFLICT") ? 409 : codes.has("PROTECTED") || codes.has("FORBIDDEN") ? 403 : codes.has("ERROR") ? 502 : 400;
    const first = results.find((r) => !r.ok) as { message?: string } | undefined;
    return NextResponse.json({ ok, results, error: ok ? undefined : first?.message }, { status });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
