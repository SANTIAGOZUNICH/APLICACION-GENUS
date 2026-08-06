import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db/client";
import { isNativePlanningEnabled } from "@/lib/planning/planning-source";
import {
  PlanningConflictError,
  PlanningForbiddenError,
  PlanningNotFoundError,
  PlanningOaCompatibilityError,
  PlanningValidationError,
} from "@/lib/planning/types";
import {
  logSanitizedError,
  sanitizePublicErrorMessage,
} from "@/lib/planning/sanitize-public-error";

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
        error: "No se pudo guardar: base de datos no disponible.",
        code: "DATABASE_UNAVAILABLE",
      },
      { status: 503 }
    );
  }
  return null;
}

export function planningErrorResponse(
  err: unknown,
  operationId?: string
): NextResponse {
  const op = operationId ?? "n/a";
  if (
    err instanceof PlanningValidationError ||
    err instanceof PlanningNotFoundError ||
    err instanceof PlanningForbiddenError
  ) {
    const isSession = /sesi[oó]n|inicie sesi|iniciar sesi/i.test(err.message);
    if (isSession) {
      return NextResponse.json(
        {
          error: "Sesión vencida. Volvé a iniciar sesión.",
          code: "UNAUTHORIZED",
          operationId: op,
        },
        { status: 401 }
      );
    }
    const status = err instanceof PlanningForbiddenError ? 403 : err.status;
    return NextResponse.json(
      {
        error: sanitizePublicErrorMessage(err, err.message),
        code: err.code,
        operationId: op,
      },
      { status }
    );
  }
  if (err instanceof PlanningOaCompatibilityError) {
    return NextResponse.json(
      {
        error: sanitizePublicErrorMessage(err, err.message),
        code: err.code,
        operationId: op,
        oaMismatch: err.details,
        canForce: true,
      },
      { status: 409 }
    );
  }
  if (err instanceof PlanningConflictError) {
    return NextResponse.json(
      {
        error: sanitizePublicErrorMessage(
          err,
          "Ya existe una asignación para esta operación."
        ),
        code: err.code,
        operationId: op,
      },
      { status: 409 }
    );
  }
  logSanitizedError(op, "planning", err);
  return NextResponse.json(
    {
      error: "No se pudo completar la operación. Reintentá.",
      code: "PLANNING_FAILED",
      operationId: op,
    },
    { status: 500 }
  );
}
