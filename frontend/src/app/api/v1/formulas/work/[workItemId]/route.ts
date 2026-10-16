import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { canLinkFormula, getWorkFormulaInfo } from "@/lib/formulas/work-formula-info";
import { retryPendingOeFormulas } from "@/lib/formulas/drive-formula-source";
import { OrdersForbiddenError } from "@/lib/orders/types";
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

/**
 * «Buscar la fórmula de nuevo» (Producción): vuelve a preparar la OE de ESTE trabajo si quedó con la fórmula pendiente.
 * Misma OE, mismo número; no reemplaza una fórmula ya cargada ni toca lotes, cantidades, consumos o stock.
 */
export async function POST(request: Request, ctx: Ctx) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canLinkFormula(actor.sector)) throw new OrdersForbiddenError("Solo Producción vuelve a buscar la fórmula de la OE.");
    const { workItemId } = await ctx.params;
    const id = workItemId.replace(/^native:/, "");
    const pending = await retryPendingOeFormulas(actor, { workItemIds: [id], limit: 1 });
    return NextResponse.json({ pending, info: await getWorkFormulaInfo(actor, id) });
  } catch (err) {
    return formulasErrorResponse(err);
  }
}
