import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import {
  isWorkViewArchiveSchemaReady,
  WorkViewArchiveSchemaPendingError,
  workViewArchiveSchemaPendingResponse,
} from "@/lib/db/work-view-archive-schema";
import { isWorkViewArchiveSector } from "@/lib/work-view-archive";
import { getWorkViewArchiveService } from "@/lib/work-view-archive/work-view-archive-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function archiveError(err: unknown) {
  if (err instanceof WorkViewArchiveSchemaPendingError) {
    return NextResponse.json(workViewArchiveSchemaPendingResponse(), { status: 503 });
  }
  return ordersErrorResponse(err);
}

export async function GET(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    const url = new URL(request.url);
    const sectorRaw = url.searchParams.get("sector")?.trim().toUpperCase() ?? "";
    if (!isWorkViewArchiveSector(sectorRaw)) {
      throw new OrdersValidationError(
        "sector inválido (ENVASADO_MASIVO | ENVASADO_PREMIUM)."
      );
    }
    if (actor.sector !== sectorRaw) {
      throw new OrdersForbiddenError(
        "Solo podés consultar archivados de tu sector operativo."
      );
    }
    const persistenceReady = await isWorkViewArchiveSchemaReady();
    const archives = await getWorkViewArchiveService().list(
      { email: actor.email, sector: actor.sector },
      sectorRaw
    );
    return NextResponse.json({
      archives,
      workItemIds: archives.map((a) => a.workItemId),
      persistenceReady,
      schemaPending: !persistenceReady,
    });
  } catch (err) {
    return archiveError(err);
  }
}

export async function POST(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    const body = (await request.json()) as {
      action?: string;
      sector?: string;
      workItemId?: string;
    };
    const sectorRaw = String(body.sector ?? "").trim().toUpperCase();
    if (!isWorkViewArchiveSector(sectorRaw)) {
      throw new OrdersValidationError(
        "sector inválido (ENVASADO_MASIVO | ENVASADO_PREMIUM)."
      );
    }
    if (actor.sector !== sectorRaw) {
      throw new OrdersForbiddenError(
        "Solo podés archivar/restaurar ítems de tu sector operativo."
      );
    }
    const workItemId = String(body.workItemId ?? "").trim();
    if (!workItemId) {
      throw new OrdersValidationError("workItemId requerido.");
    }

    const svc = getWorkViewArchiveService();
    const a = { email: actor.email, sector: actor.sector };

    if (body.action === "archive") {
      const archive = await svc.archive(a, sectorRaw, workItemId);
      return NextResponse.json({ archive }, { status: 201 });
    }
    if (body.action === "restore") {
      const result = await svc.restore(a, sectorRaw, workItemId);
      return NextResponse.json(result);
    }
    throw new OrdersValidationError("action inválida (archive | restore).");
  } catch (err) {
    return archiveError(err);
  }
}
