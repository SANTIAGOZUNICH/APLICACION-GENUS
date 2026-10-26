import "server-only";
import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import type { ProductionPedidosActor } from "@/lib/production-pedidos/types";
import { OrdersConflictError } from "./service";

export async function emailActor(request: Request): Promise<ProductionPedidosActor> {
  const a = await resolveOrdersActor(request);
  return { email: a.email, sector: a.sector, roleId: a.roleId };
}
export function emailError(err: unknown): NextResponse {
  if (err instanceof OrdersConflictError) return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
  return ordersErrorResponse(err);
}
