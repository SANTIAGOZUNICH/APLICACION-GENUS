import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db/client";
import { SchemaPendingError, schemaPendingResponse } from "@/lib/db/feature-schema";
import { AuthUnauthorizedError } from "@/lib/auth/types";
import {
  MeStockShortageError,
  OrdersConflictError,
  OrdersForbiddenError,
  OrdersNotFoundError,
  OrdersUnavailableError,
  OrdersValidationError,
} from "@/lib/orders/types";

export function ensureOrdersPersistenceReady(): NextResponse | null {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        error:
          "Neon DATABASE_URL no configurada. Las órdenes OE/OA legales requieren persistencia compartida; no se usa localStorage.",
        code: "DATABASE_UNAVAILABLE",
        legallyOperational: false,
      },
      { status: 503 }
    );
  }
  return null;
}

export function ordersErrorResponse(err: unknown): NextResponse {
  // 401 = no autenticado (cookie ausente/inválida/vencida). Distinto de
  // OrdersValidationError (400, request inválida) y OrdersForbiddenError
  // (403, autenticado sin permiso) — no mezclar las tres semánticas.
  if (err instanceof AuthUnauthorizedError) {
    return NextResponse.json(
      { error: err.message, code: err.code, legallyOperational: false },
      { status: err.status }
    );
  }
  if (err instanceof SchemaPendingError) {
    return NextResponse.json(schemaPendingResponse(), { status: 503 });
  }
  if (err instanceof AuthUnauthorizedError) {
    return NextResponse.json(
      { error: err.message, code: err.code, legallyOperational: false },
      { status: err.status }
    );
  }
  if (err instanceof MeStockShortageError) {
    return NextResponse.json(
      {
        error: err.message,
        code: err.code,
        shortages: err.shortages,
        legallyOperational: false,
      },
      { status: 400 }
    );
  }
  if (
    err instanceof OrdersValidationError ||
    err instanceof OrdersNotFoundError ||
    err instanceof OrdersForbiddenError ||
    err instanceof OrdersUnavailableError
  ) {
    return NextResponse.json(
      { error: err.message, code: err.code, legallyOperational: false },
      { status: err.status }
    );
  }
  if (err instanceof OrdersConflictError) {
    return NextResponse.json(
      {
        error: err.message,
        code: err.code,
        current: err.current,
      },
      { status: 409 }
    );
  }
  const raw = err instanceof Error ? err.message : "";
  const sensitive =
    /failed query|neon|vercel|postgres|sql|drizzle|stack|ECONN|password|DATABASE_URL|relation "|column "/i.test(
      raw
    );
  if (sensitive || !raw) {
    console.error("[orders] sanitized server error");
  } else {
    console.error(`[orders] ${raw.slice(0, 180)}`);
  }
  return NextResponse.json(
    {
      error: "No se pudo completar la operación. Reintentá.",
      code: "ORDERS_FAILED",
    },
    { status: 500 }
  );
}
