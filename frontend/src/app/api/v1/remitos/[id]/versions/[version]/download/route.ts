import { NextResponse } from "next/server";
import { getRemitoService } from "@/lib/remitos/remito-service";
import { canAccessRemitos } from "@/lib/remitos/types";
import { RemitoSchemaPendingError, remitoSchemaPendingResponse } from "@/lib/db/remito-schema";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { featureAuditEvents } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; version: string }> };

function remitosError(err: unknown) {
  if (err instanceof RemitoSchemaPendingError) {
    return NextResponse.json(remitoSchemaPendingResponse(), { status: 503 });
  }
  return ordersErrorResponse(err);
}

/**
 * Descarga autenticada de una versión de remito (PDF|XLSX).
 * GET /api/v1/remitos/:id/versions/:version/download?format=pdf|xlsx
 * Solo PRODUCCIÓN. Nunca expone URL Blob ni token.
 */
export async function GET(request: Request, ctx: Ctx) {
  try {
    const actor = resolveOrdersActor(request);
    if (!canAccessRemitos(actor.sector)) {
      throw new OrdersForbiddenError("Solo PRODUCCIÓN puede acceder a Remitos.");
    }
    const { id, version: versionRaw } = await ctx.params;
    const version = Number.parseInt(versionRaw, 10);
    if (Number.isNaN(version) || version < 1) {
      throw new OrdersValidationError("version inválida");
    }
    const url = new URL(request.url);
    const format = (url.searchParams.get("format") ?? "xlsx").toLowerCase();
    if (format !== "pdf" && format !== "xlsx") {
      throw new OrdersValidationError("format debe ser pdf|xlsx");
    }
    const customName = url.searchParams.get("filename");
    const result = await getRemitoService().download(
      { email: actor.email, sector: actor.sector },
      id,
      format,
      version
    );

    if (isDatabaseConfigured()) {
      try {
        const db = getDb();
        await db.insert(featureAuditEvents).values({
          domain: "remitos",
          action: "download",
          actorEmail: actor.email,
          actorSector: actor.sector,
          entityId: id,
          payload: { version, format, tokenRedacted: true },
        });
      } catch {
        /* best-effort */
      }
    }

    const fileName = customName?.trim() || result.fileName;
    const headers = new Headers();
    headers.set("Content-Type", result.mimeType);
    headers.set(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(fileName)}"`
    );
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    return new NextResponse(new Uint8Array(result.bytes), { status: 200, headers });
  } catch (err) {
    return remitosError(err);
  }
}
