/**
 * «Actualizar desde fórmula y lotes» — acción EXPLÍCITA sobre una OE vinculada a un trabajo de Elaboración.
 *  - POST {} → vista previa (no guarda): qué cambiaría (fórmula, cantidades, lote de fabricación, lotes de MP).
 *  - POST { confirm: true, expectedVersion } → aplica, con auditoría. Si la OE cambió desde la vista previa → 409.
 * La usan Producción (Dirección) y Elaboración. Calidad y el resto: 403. Nunca mueve stock.
 */
import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ensureOrdersPersistenceReady, ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError } from "@/lib/orders/types";
import { OeAutoPrepConflictError, prepareOeFromWork } from "@/lib/planning/oe-auto-prep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const ALLOWED = new Set(["PRODUCCION", "DIRECCION", "ELABORACION"]);

export async function POST(request: Request, ctx: Ctx) {
  const blocked = ensureOrdersPersistenceReady();
  if (blocked) return blocked;
  try {
    const { id } = await ctx.params;
    const actor = await resolveOrdersActor(request);
    if (!ALLOWED.has(actor.sector)) {
      throw new OrdersForbiddenError("Solo Producción o Elaboración pueden actualizar la OE desde la fórmula y los lotes.");
    }
    let body: { confirm?: boolean; expectedVersion?: number } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      body = {};
    }
    const confirm = body.confirm === true;
    const outcome = await prepareOeFromWork({
      orderId: id,
      actor: { email: actor.email, sector: actor.sector },
      reason: confirm ? "Actualización manual desde fórmula y lotes (revisada)" : "Vista previa",
      explicit: true,
      dryRun: !confirm,
      expectedVersion: confirm && typeof body.expectedVersion === "number" ? body.expectedVersion : undefined,
    });
    if (outcome.status === "skipped") {
      return NextResponse.json({ ok: false, status: outcome.status, message: outcome.message }, { status: 422 });
    }
    const preview = "preview" in outcome ? outcome.preview : undefined;
    return NextResponse.json({
      ok: true,
      applied: confirm && outcome.status === "applied",
      status: outcome.status,
      orderId: outcome.orderId,
      ...("version" in outcome ? { version: outcome.version } : {}),
      ...("autoPrep" in outcome ? { autoPrep: outcome.autoPrep } : {}),
      ...(preview
        ? {
            preview: {
              header: preview.header,
              materials: preview.materials.map((m) => ({
                materiaPrima: m.materiaPrima,
                codigo: m.codigo,
                formulaPct: m.formulaPct,
                kgAPesar: m.kgAPesar,
                lote: m.lote,
              })),
              procedureSteps: preview.procedureSteps.length,
            },
          }
        : {}),
    });
  } catch (err) {
    if (err instanceof OeAutoPrepConflictError) {
      return NextResponse.json({ ok: false, error: err.message, code: "ORDERS_CONFLICT" }, { status: 409 });
    }
    return ordersErrorResponse(err);
  }
}
