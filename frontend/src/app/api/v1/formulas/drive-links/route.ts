import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import { linkFormula, unlinkFormula } from "@/lib/formulas/drive-formula-source";
import { canLinkFormula } from "@/lib/formulas/work-formula-info";
import { formulasErrorResponse } from "@/lib/formulas/formulas-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = { client?: string; product?: string; fileId?: string; note?: string | null; workItemId?: string | null };

/**
 * Producción vincula el archivo correcto a cliente + producto (reemplaza el vínculo anterior, que queda en el historial).
 * Si se indica el trabajo y su OE todavía no tiene fórmula (y no empezó), se prepara la OE con el archivo vinculado
 * usando la preparación automática existente. Una OE con fórmula ya cargada NO se reemplaza.
 */
export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canLinkFormula(actor.sector)) throw new OrdersForbiddenError("Solo Producción vincula fórmulas.");
    const body = (await request.json().catch(() => null)) as Body | null;
    if (!body?.fileId) throw new OrdersValidationError("Elegí el archivo de la fórmula.");
    const link = await linkFormula(actor, { client: body.client ?? "", product: body.product ?? "", fileId: body.fileId, note: body.note });
    let oe: { status: string; message?: string; orderNumber?: string } | null = null;
    if (body.workItemId) oe = await prepareOeAfterLink(actor, body.workItemId.replace(/^native:/, "")).catch(() => ({ status: "error", message: "No se pudo preparar la OE; usá «Actualizar desde fórmula»." }));
    return NextResponse.json({ link, oe });
  } catch (err) {
    return formulasErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canLinkFormula(actor.sector)) throw new OrdersForbiddenError("Solo Producción desvincula fórmulas.");
    const url = new URL(request.url);
    const id = url.searchParams.get("id")?.trim();
    if (!id) throw new OrdersValidationError("Falta el vínculo.");
    await unlinkFormula(actor, id, url.searchParams.get("reason"));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return formulasErrorResponse(err);
  }
}

async function prepareOeAfterLink(actor: { email: string; sector: string }, workItemId: string) {
  const { getWorkFormulaInfo } = await import("@/lib/formulas/work-formula-info");
  const info = await getWorkFormulaInfo(actor, workItemId);
  if (!info.oe) return null;
  if (info.oe.formulaStatus === "ok") {
    return { status: "kept", orderNumber: info.oe.number, message: "La OE ya tenía una fórmula cargada: no se reemplazó. Para cambiarla usá «Actualizar desde fórmula» en la OE." };
  }
  const { prepareOeFromWork } = await import("@/lib/planning/oe-auto-prep");
  const out = await prepareOeFromWork({ orderId: info.oe.id, actor, reason: "Fórmula vinculada por Producción" });
  return { status: out.status, orderNumber: "orderNumber" in out ? out.orderNumber : info.oe.number, message: "message" in out ? out.message : undefined };
}
