import { NextResponse } from "next/server";
import { getRemitoService } from "@/lib/remitos/remito-service";
import type { RemitoApprovalInput, RemitoListFilters, RemitoStatus, RemitoTab } from "@/lib/remitos/types";
import { canAccessRemitos } from "@/lib/remitos/types";
import { isRemitoSchemaReady, remitoSchemaPendingResponse } from "@/lib/db/remito-schema";
import { RemitoSchemaPendingError } from "@/lib/db/remito-schema";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function remitosError(err: unknown) {
  if (err instanceof RemitoSchemaPendingError) {
    return NextResponse.json(remitoSchemaPendingResponse(), { status: 503 });
  }
  return ordersErrorResponse(err);
}

export async function GET(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    if (!canAccessRemitos(actor.sector)) {
      throw new OrdersForbiddenError("Solo PRODUCCIÓN puede acceder a Remitos.");
    }
    const url = new URL(request.url);
    const filters: RemitoListFilters = {
      tab: (url.searchParams.get("tab") as RemitoTab) || undefined,
      q: url.searchParams.get("q") ?? "",
      clientId: url.searchParams.get("clientId") ?? undefined,
      deliveryDate: url.searchParams.get("deliveryDate") ?? undefined,
      status: (url.searchParams.get("status") as RemitoStatus) || undefined,
    };
    const persistenceReady = await isRemitoSchemaReady();
    const remitos = await getRemitoService().list(
      { email: actor.email, sector: actor.sector },
      filters
    );
    return NextResponse.json({
      remitos,
      persistenceReady,
      schemaPending: !persistenceReady,
    });
  } catch (err) {
    return remitosError(err);
  }
}

export async function POST(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    if (!canAccessRemitos(actor.sector)) {
      throw new OrdersForbiddenError("Solo PRODUCCIÓN puede acceder a Remitos.");
    }
    const body = (await request.json()) as {
      action?: string;
      remitoId?: string;
      input?: RemitoApprovalInput;
      extraLines?: RemitoApprovalInput[];
    };
    const svc = getRemitoService();
    const a = { email: actor.email, sector: actor.sector };

    if (body.action === "upsert_draft" && body.input) {
      const result = await svc.upsertDraftFromApproval(a, body.input);
      return NextResponse.json(result, { status: result.created ? 201 : 200 });
    }
    if (body.action === "generate" && body.remitoId) {
      const remito = await svc.generate(a, body.remitoId);
      return NextResponse.json({ remito });
    }
    if (body.action === "new_version" && body.remitoId) {
      const remito = await svc.newVersion(a, body.remitoId, body.extraLines ?? []);
      return NextResponse.json({ remito }, { status: 201 });
    }
    if (body.action === "annul" && body.remitoId) {
      const remito = await svc.annul(a, body.remitoId);
      return NextResponse.json({ remito });
    }
    if (body.action === "archive" && body.remitoId) {
      const remito = await svc.archive(a, body.remitoId);
      return NextResponse.json({ remito });
    }
    return NextResponse.json({ error: "action inválida" }, { status: 400 });
  } catch (err) {
    return remitosError(err);
  }
}
