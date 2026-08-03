import { NextResponse } from "next/server";
import { getAuthAdminService } from "@/lib/auth/get-auth-service";
import { authErrorResponse } from "@/lib/auth/http";
import { requireSuperadminActor } from "@/lib/auth/require-superadmin";
import type { AuthUserStatus } from "@/lib/auth/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const actor = await requireSuperadminActor(request);
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Body JSON requerido." }, { status: 400 });
    }
    const user = await getAuthAdminService().updateUser(actor, id, {
      displayName: typeof body.displayName === "string" ? body.displayName : undefined,
      email: typeof body.email === "string" ? body.email : undefined,
      sector: typeof body.sector === "string" ? body.sector : undefined,
      status: typeof body.status === "string" ? (body.status as AuthUserStatus) : undefined,
      reason: typeof body.reason === "string" ? body.reason : undefined,
    });
    return NextResponse.json(
      { user },
      { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } }
    );
  } catch (err) {
    return authErrorResponse(err);
  }
}
