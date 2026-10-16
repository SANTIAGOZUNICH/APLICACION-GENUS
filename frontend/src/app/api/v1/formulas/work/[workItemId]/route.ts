import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { getWorkFormulaInfo } from "@/lib/formulas/work-formula-info";
import { formulasErrorResponse } from "@/lib/formulas/formulas-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ workItemId: string }> };

/** «Ver OE / Fórmula» de un trabajo: OE vinculada + archivo de la fórmula (y, para Producción, opciones a elegir). */
export async function GET(request: Request, ctx: Ctx) {
  try {
    const actor = await resolveOrdersActor(request);
    const { workItemId } = await ctx.params;
    return NextResponse.json(await getWorkFormulaInfo(actor, workItemId));
  } catch (err) {
    return formulasErrorResponse(err);
  }
}
