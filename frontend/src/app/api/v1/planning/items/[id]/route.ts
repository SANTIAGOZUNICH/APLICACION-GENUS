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
import type { PatchWorkItemInput } from "@/lib/planning/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;
  try {
    const actor = resolvePlanningActor(request);
    assertProduccionActor(actor);
    const { id } = await context.params;
    const body = (await request.json()) as PatchWorkItemInput;
    if (body.version == null) {
      return NextResponse.json(
        { error: "version requerida para PATCH.", code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }
    const item = await getPlanningService().patchItem(id, body, actor);
    return NextResponse.json({ item });
  } catch (err) {
    return planningErrorResponse(err);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;
  try {
    const actor = resolvePlanningActor(request);
    assertProduccionActor(actor);
    const { id } = await context.params;
    const result = await getPlanningService().deleteItem(id, actor);
    return NextResponse.json(result);
  } catch (err) {
    return planningErrorResponse(err);
  }
}
