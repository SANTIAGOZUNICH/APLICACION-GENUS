import { NextResponse } from "next/server";
import {
  assertProduccionActor,
  resolvePlanningActor,
} from "@/lib/planning/actor";
import { getPlanningService } from "@/lib/planning/get-planning-service";
import {
  ensureNativePlanningReady,
  planningErrorResponse,
} from "@/lib/planning/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;
  try {
    const actor = resolvePlanningActor(request);
    assertProduccionActor(actor);
    const { id } = await context.params;
    const result = await getPlanningService().publishWeek(id, actor);
    return NextResponse.json(result);
  } catch (err) {
    return planningErrorResponse(err);
  }
}
