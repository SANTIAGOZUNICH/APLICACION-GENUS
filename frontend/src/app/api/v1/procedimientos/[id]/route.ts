import { NextResponse } from "next/server";
import { getProcedimientosService } from "@/lib/procedimientos/procedimientos-service";
import { canAccessProcedimientos } from "@/lib/procedimientos/types";
import {
  isProcedureMetricsSchemaReady,
  procedureMetricsSchemaPendingResponse,
  ProcedureMetricsSchemaPendingError,
} from "@/lib/db/procedure-metrics-schema";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function errorResponse(err: unknown) {
  if (err instanceof ProcedureMetricsSchemaPendingError) {
    return NextResponse.json(procedureMetricsSchemaPendingResponse(), { status: 503 });
  }
  return ordersErrorResponse(err);
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = resolveOrdersActor(request);
    if (!canAccessProcedimientos(actor.sector)) {
      throw new OrdersForbiddenError("Sin acceso a Procedimientos.");
    }
    const { id } = await context.params;
    const url = new URL(request.url);
    const persistenceReady = await isProcedureMetricsSchemaReady();
    const svc = getProcedimientosService();
    const a = { email: actor.email, sector: actor.sector };

    if (url.searchParams.get("versions") === "1") {
      const versions = await svc.listVersions(a, id);
      const file = await svc.getFile(id);
      return NextResponse.json({
        file,
        versions,
        persistenceReady,
        schemaPending: !persistenceReady,
      });
    }

    const file = await svc.getFile(id);
    return NextResponse.json({
      file,
      persistenceReady,
      schemaPending: !persistenceReady,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
