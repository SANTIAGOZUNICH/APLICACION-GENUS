import { NextResponse } from "next/server";
import { getMetricasService } from "@/lib/metricas/metricas-service";
import { canAccessMetricas, MetricsConflictError } from "@/lib/metricas/types";
import type { MetricsListFilters } from "@/lib/metricas/types";
import {
  isProcedureMetricsSchemaReady,
  procedureMetricsSchemaPendingResponse,
  ProcedureMetricsSchemaPendingError,
} from "@/lib/db/procedure-metrics-schema";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(err: unknown) {
  if (err instanceof ProcedureMetricsSchemaPendingError) {
    return NextResponse.json(procedureMetricsSchemaPendingResponse(), { status: 503 });
  }
  if (err instanceof MetricsConflictError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
  }
  return ordersErrorResponse(err);
}

export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canAccessMetricas(actor.sector)) {
      throw new OrdersForbiddenError(
        "Métricas solo para Envasado Masivo, Premium y Producción."
      );
    }
    const url = new URL(request.url);
    const sectorParam = url.searchParams.get("sector");
    const filters: MetricsListFilters = {
      dateFrom: url.searchParams.get("dateFrom") ?? undefined,
      dateTo: url.searchParams.get("dateTo") ?? undefined,
      product: url.searchParams.get("product") ?? undefined,
      responsible: url.searchParams.get("responsible") ?? undefined,
      sector:
        sectorParam === "ENVASADO_MASIVO" ||
        sectorParam === "ENVASADO_PREMIUM" ||
        sectorParam === "ALL"
          ? sectorParam
          : undefined,
      onlyDeleted: url.searchParams.get("onlyDeleted") === "1",
    };
    const persistenceReady = await isProcedureMetricsSchemaReady();
    const svc = getMetricasService();
    const a = { email: actor.email, sector: actor.sector };
    const metrics = await svc.list(a, filters);
    const { ranking, totals } = await svc.ranking(a, filters);

    return NextResponse.json({
      metrics,
      ranking,
      totals,
      persistenceReady,
      schemaPending: !persistenceReady,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canAccessMetricas(actor.sector)) {
      throw new OrdersForbiddenError(
        "Métricas solo para Envasado Masivo, Premium y Producción."
      );
    }
    const body = (await request.json()) as {
      action?: string;
      id?: string;
      metricDate?: string;
      product?: string | null;
      units?: number;
      responsibleDisplay?: string;
      targetSector?: "ENVASADO_MASIVO" | "ENVASADO_PREMIUM" | null;
      expectedUpdatedAt?: string;
      via?: "form" | "grid";
      rows?: unknown[];
      batchId?: string;
      overwrite?: Record<string, string>;
    };
    const svc = getMetricasService();
    const a = { email: actor.email, sector: actor.sector };

    if (body.action === "create") {
      const metric = await svc.create(a, {
        metricDate: String(body.metricDate ?? ""),
        product: body.product,
        units: Number(body.units ?? 0),
        responsibleDisplay: String(body.responsibleDisplay ?? ""),
        targetSector: body.targetSector,
      });
      return NextResponse.json({ metric }, { status: 201 });
    }
    if (body.action === "update" && body.id) {
      const metric = await svc.update(a, body.id, {
        metricDate: body.metricDate,
        product: body.product,
        units: body.units,
        responsibleDisplay: body.responsibleDisplay,
        expectedUpdatedAt: body.expectedUpdatedAt,
        via: body.via === "grid" ? "grid" : "form",
      });
      return NextResponse.json({ metric });
    }
    if (body.action === "import_preview") {
      const rows = await svc.importPreview(a, body.rows ?? []);
      return NextResponse.json({ rows });
    }
    if (body.action === "import_commit") {
      const result = await svc.importCommit(a, {
        batchId: String(body.batchId ?? ""),
        rows: body.rows ?? [],
        overwrite: body.overwrite,
      });
      return NextResponse.json(result);
    }
    if (body.action === "delete" && body.id) {
      await svc.delete(a, body.id);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "restore" && body.id) {
      const metric = await svc.restore(a, body.id);
      return NextResponse.json({ metric });
    }

    throw new OrdersValidationError("action desconocida");
  } catch (err) {
    return errorResponse(err);
  }
}
