import { NextResponse } from "next/server";
import { getAuthAdminService } from "@/lib/auth/get-auth-service";
import { authErrorResponse } from "@/lib/auth/http";
import { requireSuperadminActor } from "@/lib/auth/require-superadmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  try {
    const actor = await requireSuperadminActor(request);
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const result = await getAuthAdminService().resetPassword(actor, id, {
      newPassword: typeof body?.newPassword === "string" ? body.newPassword : "",
      reason: typeof body?.reason === "string" ? body.reason : undefined,
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}
