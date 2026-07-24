import { NextResponse } from "next/server";
import { getRemitoService } from "@/lib/remitos/remito-service";
import { canAccessRemitos } from "@/lib/remitos/types";
import type { RemitoApprovalInput } from "@/lib/remitos/types";
import {
  isRemitoSchemaReady,
  RemitoSchemaPendingError,
  remitoSchemaPendingResponse,
} from "@/lib/db/remito-schema";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError, OrdersNotFoundError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function remitosError(err: unknown) {
  if (err instanceof RemitoSchemaPendingError) {
    return NextResponse.json(remitoSchemaPendingResponse(), { status: 503 });
  }
  return ordersErrorResponse(err);
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  try {
    const actor = resolveOrdersActor(request);
    if (!canAccessRemitos(actor.sector)) {
      throw new OrdersForbiddenError("Solo PRODUCCIÓN puede acceder a Remitos.");
    }
    const { id } = await ctx.params;
    const persistenceReady = await isRemitoSchemaReady();
    const remito = await getRemitoService().get(
      { email: actor.email, sector: actor.sector },
      id
    );
    if (!remito) throw new OrdersNotFoundError("Remito no encontrado.");
    return NextResponse.json({
      remito,
      persistenceReady,
      schemaPending: !persistenceReady,
    });
  } catch (err) {
    return remitosError(err);
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const actor = resolveOrdersActor(request);
    if (!canAccessRemitos(actor.sector)) {
      throw new OrdersForbiddenError("Solo PRODUCCIÓN puede acceder a Remitos.");
    }
    const { id } = await ctx.params;
    const body = (await request.json()) as {
      action?: string;
      extraLines?: RemitoApprovalInput[];
    };
    const svc = getRemitoService();
    const a = { email: actor.email, sector: actor.sector };

    if (body.action === "generate") {
      return NextResponse.json({ remito: await svc.generate(a, id) });
    }
    if (body.action === "new_version") {
      return NextResponse.json(
        { remito: await svc.newVersion(a, id, body.extraLines ?? []) },
        { status: 201 }
      );
    }
    if (body.action === "annul") {
      return NextResponse.json({ remito: await svc.annul(a, id) });
    }
    if (body.action === "archive") {
      return NextResponse.json({ remito: await svc.archive(a, id) });
    }
    return NextResponse.json({ error: "action inválida" }, { status: 400 });
  } catch (err) {
    return remitosError(err);
  }
}
