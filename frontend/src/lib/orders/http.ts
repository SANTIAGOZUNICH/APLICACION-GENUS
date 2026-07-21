import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db/client";
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
  const message = err instanceof Error ? err.message : "Error en órdenes OE/OA.";
  return NextResponse.json(
    { error: message, code: "ORDERS_FAILED" },
    { status: 500 }
  );
}
