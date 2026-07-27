import { NextResponse } from "next/server";
import { getProcedimientosService } from "@/lib/procedimientos/procedimientos-service";
import { canAccessProcedimientos } from "@/lib/procedimientos/types";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Descarga de procedimiento vía proxy servidor.
 * GET /api/v1/procedimientos/download?fileId=&version=&preview=1
 */
export async function GET(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    if (!canAccessProcedimientos(actor.sector)) {
      throw new OrdersForbiddenError("Sin acceso a Procedimientos.");
    }
    const url = new URL(request.url);
    const fileId = url.searchParams.get("fileId") ?? "";
    const versionRaw = url.searchParams.get("version");
    const version = versionRaw ? Number(versionRaw) : undefined;
    const preview = url.searchParams.get("preview") === "1";

    if (!fileId.trim()) {
      return NextResponse.json({ error: "fileId requerido" }, { status: 400 });
    }

    const result = await getProcedimientosService().downloadVersion(
      { email: actor.email, sector: actor.sector },
      fileId,
      version
    );

    const headers = new Headers();
    headers.set("Content-Type", result.mimeType);
    const inline =
      preview &&
      (result.mimeType === "application/pdf" || result.mimeType.startsWith("image/"));
    headers.set(
      "Content-Disposition",
      inline
        ? `inline; filename="${encodeURIComponent(result.fileName)}"`
        : `attachment; filename="${encodeURIComponent(result.fileName)}"`
    );
    headers.set("Cache-Control", "private, no-store");

    return new NextResponse(new Uint8Array(result.bytes), { status: 200, headers });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
