import "server-only";

import { NextResponse } from "next/server";
import { ordersErrorResponse } from "@/lib/orders/http";
import { FormulaSourceError } from "./drive-formula-source";

/** Errores de la fuente de fórmulas → HTTP (el resto lo resuelve el mapeador común de órdenes). */
export function formulasErrorResponse(err: unknown) {
  if (err instanceof FormulaSourceError) return NextResponse.json({ error: err.message }, { status: err.status });
  return ordersErrorResponse(err);
}
