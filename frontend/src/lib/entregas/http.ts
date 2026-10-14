import "server-only";

import { NextResponse } from "next/server";
import { ordersErrorResponse } from "@/lib/orders/http";
import { EntregasConflictError } from "./types";

/** Errores de Entregas → HTTP (409 para conflictos de versión / vínculo; el resto lo resuelve el mapeador común). */
export function entregasErrorResponse(err: unknown) {
  if (err instanceof EntregasConflictError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
  }
  return ordersErrorResponse(err);
}
