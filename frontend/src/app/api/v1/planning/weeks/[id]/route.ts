import { NextResponse } from "next/server";
import { resolvePlanningActor } from "@/lib/planning/actor";
import { getPlanningService } from "@/lib/planning/get-planning-service";
import {
  ensureNativePlanningReady,
  planningErrorResponse,
} from "@/lib/planning/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;
  try {
    resolvePlanningActor(request);
    const { id } = await context.params;
    const result = await getPlanningService().getWeek(id);
    return NextResponse.json(result);
  } catch (err) {
    return planningErrorResponse(err);
  }
}
