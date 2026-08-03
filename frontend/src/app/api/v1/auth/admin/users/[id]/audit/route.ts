import { NextResponse } from "next/server";
import { getAuthAdminService } from "@/lib/auth/get-auth-service";
import { authErrorResponse } from "@/lib/auth/http";
import { requireSuperadminActor } from "@/lib/auth/require-superadmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  try {
    await requireSuperadminActor(request);
    const { id } = await ctx.params;
    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get("limit") || "50");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
    const events = await getAuthAdminService().listAuditForUser(id, limit);
    return NextResponse.json(
      { events },
      { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } }
    );
  } catch (err) {
    return authErrorResponse(err);
  }
}
