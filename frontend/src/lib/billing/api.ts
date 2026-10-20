import "server-only";

import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ensureOrdersPersistenceReady, ordersErrorResponse } from "@/lib/orders/http";
import { isMissingSchemaError } from "@/lib/db/missing-schema";
import type { BillingActor } from "./billing-service";

export async function withBillingActor(request: Request, run: (actor: BillingActor) => Promise<Response>): Promise<Response> {
  try {
    const actor = await resolveOrdersActor(request);
    const notReady = ensureOrdersPersistenceReady();
    if (notReady) return notReady;
    return await run({ email: actor.email, sector: actor.sector, displayName: actor.displayName });
  } catch (err) {
    if (isMissingSchemaError(err)) {
      return NextResponse.json({ error: "El Control de facturación todavía no está disponible en esta base (migración 0062 pendiente).", code: "SCHEMA_PENDING" }, { status: 503 });
    }
    return ordersErrorResponse(err);
  }
}

export const noStore = { "Cache-Control": "no-store" } as const;
