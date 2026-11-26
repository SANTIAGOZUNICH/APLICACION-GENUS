import "server-only";

import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersValidationError } from "@/lib/orders/types";
import { UbicacionesConflictError } from "./service";
import type { UbActor } from "./types";

/** Identidad resuelta SOLO por la sesión (cookie), como el resto de los módulos. */
export async function resolveUbActor(request: Request): Promise<UbActor> {
  const a = await resolveOrdersActor(request);
  return { email: a.email, sector: a.sector, displayName: a.displayName };
}

export async function readJson<T extends object>(request: Request): Promise<T> {
  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object") throw new Error("body");
    return body as T;
  } catch {
    throw new OrdersValidationError("El cuerpo de la solicitud no es un JSON válido.");
  }
}

export function ubErrorResponse(err: unknown): NextResponse {
  if (err instanceof UbicacionesConflictError) return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
  return ordersErrorResponse(err);
}
