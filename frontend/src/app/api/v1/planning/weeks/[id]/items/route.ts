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
import type { CreateWorkItemInput } from "@/lib/planning/types";

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
    const body = (await request.json()) as CreateWorkItemInput;
    const item = await getPlanningService().createItem(id, body, actor);
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    return planningErrorResponse(err);
  }
}
