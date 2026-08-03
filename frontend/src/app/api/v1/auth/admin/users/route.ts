import { NextResponse } from "next/server";
import { getAuthAdminService } from "@/lib/auth/get-auth-service";
import { authErrorResponse } from "@/lib/auth/http";
import { requireSuperadminActor } from "@/lib/auth/require-superadmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireSuperadminActor(request);
    const users = await getAuthAdminService().listPublicUsers();
    return NextResponse.json(
      { users },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex, nofollow",
        },
      }
    );
  } catch (err) {
    return authErrorResponse(err);
  }
}
