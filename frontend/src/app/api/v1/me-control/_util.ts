import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersValidationError } from "@/lib/orders/types";
import type { MeControlActor } from "@/lib/me-control/service";

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function actorOf(request: Request): Promise<MeControlActor> {
  const a = await resolveOrdersActor(request);
  return { email: a.email, sector: a.sector, roleId: a.roleId };
}

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const b = await request.json();
    if (b && typeof b === "object" && !Array.isArray(b)) return b as Record<string, unknown>;
  } catch {
    /* cae al error */
  }
  throw new OrdersValidationError("Cuerpo inválido.");
}

export async function run(request: Request, fn: (actor: MeControlActor) => Promise<unknown>, status = 200): Promise<NextResponse> {
  try {
    return NextResponse.json(await fn(await actorOf(request)), { status, headers: NO_STORE });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
