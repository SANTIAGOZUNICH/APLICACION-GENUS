import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db/client";
import { AuthUnauthorizedError } from "@/lib/auth/types";
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
  // 401 = no autenticado, verificado por tipo (no por texto del mensaje —
  // el sniffing por regex podía coincidir con mensajes de negocio
  // legítimos que mencionaran "sesión" sin ser un problema de auth).
  if (err instanceof AuthUnauthorizedError) {
    return NextResponse.json(
      { error: err.message, code: err.code, operationId: op },
      { status: err.status }
    );
  }
  if (
    err instanceof PlanningValidationError ||
    err instanceof PlanningNotFoundError ||
    err instanceof PlanningForbiddenError
  ) {
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
