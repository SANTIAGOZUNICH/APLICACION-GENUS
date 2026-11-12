import { NextResponse } from "next/server";
import { listMeHistory, setWorkItemMeStatus } from "@/lib/planning/me-control-service";
import { resolvePlanningActor } from "@/lib/planning/actor";
import { ensureNativePlanningReady, planningErrorResponse } from "@/lib/planning/http";
import { parseMeStatus } from "@/lib/me-status/me-status";
import { PlanningValidationError } from "@/lib/planning/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — historial del control de ME del trabajo (cualquier sector autenticado puede consultar). */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;
  try {
    await resolvePlanningActor(request);
    const { id } = await ctx.params;
    return NextResponse.json({ history: await listMeHistory(id) });
  } catch (err) {
    return planningErrorResponse(err);
  }
}

/**
 * POST { status: "OK" | "NO_OK" | "SIN_INFO", observation? } — marca el ME del trabajo de Envasado. SOLO Depósito (y Dirección): el permiso se
 * valida acá, en el servidor, con el sector autenticado (nunca el que mande el cliente). Informativo: sin movimientos de stock.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;
  try {
    const actor = await resolvePlanningActor(request);
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new PlanningValidationError("Body JSON inválido.");
    const status = parseMeStatus(body.status);
    if (!status) throw new PlanningValidationError("Estado de ME inválido (usá OK, NO_OK o SIN_INFO).");
    const result = await setWorkItemMeStatus(actor, id, { status, observation: typeof body.observation === "string" ? body.observation : null });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return planningErrorResponse(err);
  }
}
