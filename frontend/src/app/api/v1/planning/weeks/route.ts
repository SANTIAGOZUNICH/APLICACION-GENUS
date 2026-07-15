import { NextResponse } from "next/server";
import {
  ACTOR_EMAIL_HEADER,
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

export async function GET(request: Request) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;
  try {
    resolvePlanningActor(request);
    const url = new URL(request.url);
    const weekStart = url.searchParams.get("weekStart");
    const weeks = await getPlanningService().listWeeks(weekStart);
    return NextResponse.json({ weeks });
  } catch (err) {
    return planningErrorResponse(err);
  }
}

export async function POST(request: Request) {
  const blocked = ensureNativePlanningReady();
  if (blocked) return blocked;
  try {
    const actor = resolvePlanningActor(request);
    assertProduccionActor(actor);
    const body = (await request.json()) as { weekStart?: string; label?: string };
    if (!body.weekStart) {
      return NextResponse.json(
        { error: "weekStart requerido.", code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }
    const week = await getPlanningService().createWeek(
      { weekStart: body.weekStart, label: body.label },
      actor
    );
    return NextResponse.json({ week }, { status: 201 });
  } catch (err) {
    return planningErrorResponse(err);
  }
}

export { ACTOR_EMAIL_HEADER };
