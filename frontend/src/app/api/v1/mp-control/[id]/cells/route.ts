import { NextResponse } from "next/server";
import { MAX_MP_LINE_CELL_CHANGES, type MpLineCellChange } from "@/lib/mp-control/cell-edit";
import { MpControlCellError, getMpControlService } from "@/lib/mp-control/mp-control-service";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH parcial por celda de las líneas del Control semanal (solo BORRADOR, con versión). */
export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const actor = await resolveOrdersActor(request);
    const { id } = await ctx.params;
    const body = (await request.json()) as { changes?: MpLineCellChange[]; expectedVersion?: string };
    if (!Array.isArray(body.changes) || typeof body.expectedVersion !== "string" || body.changes.length > MAX_MP_LINE_CELL_CHANGES) {
      return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
    }
    const control = await getMpControlService().patchLineCells(
      { email: actor.email, sector: actor.sector },
      id,
      body.changes,
      body.expectedVersion
    );
    return NextResponse.json({ control });
  } catch (err) {
    if (err instanceof MpControlCellError) {
      const status = err.code === "CONFLICT" ? 409 : err.code === "PROTECTED" ? 403 : err.code === "NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    return ordersErrorResponse(err);
  }
}
