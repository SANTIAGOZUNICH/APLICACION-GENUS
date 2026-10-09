import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db/client";
import { SchemaPendingError, schemaPendingResponse } from "@/lib/db/feature-schema";
import { isMissingSchemaError, sqlStateOf } from "@/lib/db/missing-schema";
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
  // La base no tiene una columna/tabla que este código usa (migración pendiente): 503 con motivo claro, nunca un
  // 500 genérico que la UI no sabe explicar. Se registra el SQLSTATE (sin SQL ni datos) para diagnosticarlo.
  if (isMissingSchemaError(err)) {
    console.error(`[orders] schema pendiente (SQLSTATE ${sqlStateOf(err)}): falta aplicar una migración en la base`);
    return NextResponse.json(
      {
        error:
          "La base de datos todavía no tiene la estructura que necesita esta versión de GENUS (migración pendiente). Los cambios no se pueden guardar hasta que se aplique.",
        code: "SCHEMA_PENDING",
        schemaPending: true,
      },
      { status: 503 }
    );
  }
  const raw = err instanceof Error ? err.message : "";
  const sensitive =
    /failed query|neon|vercel|postgres|sql|drizzle|stack|ECONN|password|DATABASE_URL|relation "|column "/i.test(
      raw
    );
  if (sensitive || !raw) {
    console.error(`[orders] sanitized server error${sqlStateOf(err) ? ` (SQLSTATE ${sqlStateOf(err)})` : ""}`);
    return NextResponse.json(
      {
        error: "No se pudo completar la operación. Reintentá.",
        code: "ORDERS_FAILED",
      },
      { status: 500 }
    );
  }
  // Mensaje no sensible (ej. "Almacenamiento privado de archivos no
  // configurado.") — antes se sanitizaba igual que uno con datos internos,
  // dejando a la UI sin nada real que mostrar. El chequeo `sensitive` de
  // arriba ya filtra lo que no debe salir; lo que pasa ese filtro es seguro
  // de exponer tal cual.
  console.error(`[orders] ${raw.slice(0, 180)}`);
  return NextResponse.json({ error: raw, code: "ORDERS_FAILED" }, { status: 500 });
}
