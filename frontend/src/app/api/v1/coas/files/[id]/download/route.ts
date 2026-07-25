import { NextResponse } from "next/server";
import { getCoaService } from "@/lib/coa/coa-service";
import { canViewCoas } from "@/lib/coa/types";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Descarga autenticada COA — nunca expone URL Blob ni token.
 * GET /api/v1/coas/files/:id/download?version=
 */
export async function GET(request: Request, ctx: Ctx) {
  try {
    const actor = resolveOrdersActor(request);
    if (!canViewCoas(actor.sector)) {
      throw new OrdersForbiddenError("Sin acceso a COA'S.");
    }
    const { id } = await ctx.params;
    const url = new URL(request.url);
    const versionRaw = url.searchParams.get("version");
    const version = versionRaw ? Number(versionRaw) : undefined;

    const result = await getCoaService().downloadVersion(
      { email: actor.email, sector: actor.sector },
      id,
      version
    );

    const headers = new Headers();
    headers.set("Content-Type", result.mimeType);
    headers.set(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(result.fileName)}"`
    );
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Content-Type-Options", "nosniff");

    return new NextResponse(new Uint8Array(result.bytes), { status: 200, headers });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
