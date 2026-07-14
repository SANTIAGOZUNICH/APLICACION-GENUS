import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db/client";
import { isNativePlanningEnabled } from "@/lib/planning/planning-source";
import {
  PlanningConflictError,
  PlanningForbiddenError,
  PlanningNotFoundError,
  PlanningValidationError,
} from "@/lib/planning/types";

export function ensureNativePlanningReady(): NextResponse | null {
  if (!isNativePlanningEnabled()) {
    return NextResponse.json(
      {
        error: "Planificación nativa deshabilitada.",
        code: "PLANNING_SOURCE_SHEETS",
      },
      { status: 503 }
    );
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        error: "Neon DATABASE_URL no configurada en este entorno.",
        code: "DATABASE_UNAVAILABLE",
      },
      { status: 503 }
    );
  }
  return null;
}

export function planningErrorResponse(err: unknown): NextResponse {
  if (
    err instanceof PlanningValidationError ||
    err instanceof PlanningNotFoundError ||
    err instanceof PlanningForbiddenError
  ) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.status }
    );
  }
  if (err instanceof PlanningConflictError) {
    return NextResponse.json(
      {
        error: err.message,
        code: err.code,
        current: err.current,
      },
      { status: 409 }
    );
  }
  const message = err instanceof Error ? err.message : "Error de planificación.";
  return NextResponse.json(
    { error: message, code: "PLANNING_FAILED" },
    { status: 500 }
  );
}
