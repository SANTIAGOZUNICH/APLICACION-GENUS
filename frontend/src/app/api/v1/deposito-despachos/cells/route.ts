import { NextResponse } from "next/server";
import { MAX_DESPACHO_CELL_CHANGES, type DespachoCellChange } from "@/lib/despachos/cell-edit";
import { getDespachosService } from "@/lib/despachos/despachos-service";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH parcial por celda. 409 si otro usuario modificó el registro. */
export async function PATCH(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const body = (await request.json()) as { changes?: DespachoCellChange[] };
    if (!Array.isArray(body.changes) || body.changes.length > MAX_DESPACHO_CELL_CHANGES) {
      return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
    }
    const results = await getDespachosService().patchCells(
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
