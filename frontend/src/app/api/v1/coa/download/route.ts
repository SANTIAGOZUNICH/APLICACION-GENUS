import { NextResponse } from "next/server";
import { getCoaService } from "@/lib/coa/coa-service";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Descarga de versión COA vía proxy servidor (credenciales nunca al cliente).
 * GET /api/v1/coa/download?fileId=&version=
 */
export async function GET(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    const url = new URL(request.url);
    const fileId = url.searchParams.get("fileId") ?? "";
    const versionRaw = url.searchParams.get("version");
    const version = versionRaw ? Number(versionRaw) : undefined;
    const preview = url.searchParams.get("preview") === "1";

    if (!fileId.trim()) {
      return NextResponse.json({ error: "fileId requerido" }, { status: 400 });
    }

    const result = await getCoaService().downloadVersion(
      { email: actor.email, sector: actor.sector },
      fileId,
      version
    );

    const headers = new Headers();
    headers.set("Content-Type", result.mimeType);
    headers.set(
      "Content-Disposition",
      preview && result.mimeType === "application/pdf"
        ? `inline; filename="${encodeURIComponent(result.fileName)}"`
        : `attachment; filename="${encodeURIComponent(result.fileName)}"`
    );
    headers.set("Cache-Control", "private, no-store");

    return new NextResponse(new Uint8Array(result.bytes), { status: 200, headers });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
