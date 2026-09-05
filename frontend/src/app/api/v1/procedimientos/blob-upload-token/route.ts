import { NextResponse } from "next/server";
import { getProcedimientosService } from "@/lib/procedimientos/procedimientos-service";
import { canAccessProcedimientos } from "@/lib/procedimientos/types";
import type { VersionUploadMode } from "@/lib/procedimientos/types";
import {
  procedureMetricsSchemaPendingResponse,
  ProcedureMetricsSchemaPendingError,
} from "@/lib/db/procedure-metrics-schema";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(err: unknown) {
  if (err instanceof ProcedureMetricsSchemaPendingError) {
    return NextResponse.json(procedureMetricsSchemaPendingResponse(), { status: 503 });
  }
  return ordersErrorResponse(err);
}

/**
 * Paso 1 de la subida directa cliente→Blob para archivos que excederían el
 * límite de payload de una función serverless de Vercel (~4.5MB). Emite un
 * token de un solo uso; el archivo en sí nunca pasa por esta ruta.
 * Ver frontend/src/lib/procedimientos/procedimientos-client.ts.
 */
export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canAccessProcedimientos(actor.sector)) {
      throw new OrdersForbiddenError("Sin acceso a Procedimientos.");
    }
    const body = (await request.json()) as {
      folderId?: string;
      fileName?: string;
      mimeType?: string;
      sizeBytes?: number;
      mode?: string;
      existingFileId?: string;
    };

    const svc = getProcedimientosService();
    const result = await svc.prepareBlobUpload(
      { email: actor.email, sector: actor.sector },
      {
        folderId: String(body.folderId ?? ""),
        fileName: String(body.fileName ?? ""),
        mimeType: String(body.mimeType ?? "application/octet-stream"),
        sizeBytes: Number(body.sizeBytes ?? 0),
        mode: body.mode ? (String(body.mode) as VersionUploadMode) : undefined,
        existingFileId: body.existingFileId ? String(body.existingFileId) : undefined,
      }
    );

    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
