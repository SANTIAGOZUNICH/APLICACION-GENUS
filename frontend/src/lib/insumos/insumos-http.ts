import "server-only";

import { resolveOrdersActor } from "@/lib/orders/actor";
import { OrdersValidationError } from "@/lib/orders/types";
import type { InsumoActor } from "./types";

/** Identidad del que llama, resuelta SOLO por la sesión (cookie) — igual que el resto de los módulos. */
export async function resolveInsumoActor(request: Request): Promise<InsumoActor> {
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
