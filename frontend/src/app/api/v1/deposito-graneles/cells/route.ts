import { NextResponse } from "next/server";
import { MAX_GRANEL_CELL_CHANGES, type GranelCellChange } from "@/lib/graneles/cell-edit";
import { getGranelesService } from "@/lib/graneles/graneles-service";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH parcial por celda de Depósito Graneles. 409 si hay conflicto de versión. */
export async function PATCH(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const body = (await request.json()) as { changes?: GranelCellChange[] };
    if (!Array.isArray(body.changes) || body.changes.length > MAX_GRANEL_CELL_CHANGES) {
      return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
    }
    const results = await getGranelesService().patchCells(
      { email: actor.email, sector: actor.sector, displayName: actor.displayName },
      body.changes
    );
    const ok = results.every((r) => r.ok);
    const status = ok ? 200 : results.some((r) => !r.ok && r.code === "CONFLICT") ? 409 : 422;
    return NextResponse.json({ ok, results }, { status });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
