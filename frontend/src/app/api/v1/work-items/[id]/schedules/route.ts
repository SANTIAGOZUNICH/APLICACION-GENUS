import { NextResponse } from "next/server";
import { resolvePlanningActor } from "@/lib/planning/actor";
import { ensureNativePlanningReady, planningErrorResponse } from "@/lib/planning/http";
import { nativeIdFromItemId } from "@/lib/planning/work-item-progress-repository";
import { addSchedulesDurable, listSchedulesDurable, removeScheduleDurable } from "@/lib/planning/work-schedules-service";
import { PlanningNotFoundError, PlanningValidationError } from "@/lib/planning/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Programaciones (días) de la misma OE/OA a la que pertenece el trabajo. Lectura para cualquier sector autenticado. */
export async function GET(request: Request, ctx: Ctx) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;
  try {
    await resolvePlanningActor(request);
    const { id } = await ctx.params;
    const out = await listSchedulesDurable(nativeIdFromItemId(id) ?? id);
    if (!out) throw new PlanningNotFoundError("Trabajo no encontrado.");
    return NextResponse.json(out);
  } catch (err) {
    return planningErrorResponse(err);
  }
}

/**
 * POST { items: [{ plannedDate, plannedDateTo?, quantity? }], rebalanceSource?, allowExceed?, idempotencyKey }
 * Agrega programaciones de la MISMA orden (no crea OE/OA). Solo Producción.
 */
export async function POST(request: Request, ctx: Ctx) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;
  try {
    const actor = await resolvePlanningActor(request);
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { items?: unknown; rebalanceSource?: unknown; allowExceed?: unknown; idempotencyKey?: unknown } | null;
    if (!body || !Array.isArray(body.items)) throw new PlanningValidationError("Falta la lista de días.");
    const items = (body.items as Array<Record<string, unknown>>).map((it) => ({
      plannedDate: String(it.plannedDate ?? ""),
      plannedDateTo: it.plannedDateTo == null ? null : String(it.plannedDateTo),
      quantity: it.quantity == null || String(it.quantity).trim() === "" ? null : (it.quantity as string | number),
    }));
    const out = await addSchedulesDurable(
      { sourceId: nativeIdFromItemId(id) ?? id, items, rebalanceSource: body.rebalanceSource === true, allowExceed: body.allowExceed === true, idempotencyKey: String(body.idempotencyKey ?? "") },
      actor
    );
    return NextResponse.json(out, { status: out.replayed ? 200 : 201 });
  } catch (err) {
    return planningErrorResponse(err);
  }
}

/** Quita ESTA programación (no la orden). Sin motivo obligatorio; auditado. */
export async function DELETE(request: Request, ctx: Ctx) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;
  try {
    const actor = await resolvePlanningActor(request);
    const { id } = await ctx.params;
    return NextResponse.json(await removeScheduleDurable(nativeIdFromItemId(id) ?? id, actor));
  } catch (err) {
    return planningErrorResponse(err);
  }
}
