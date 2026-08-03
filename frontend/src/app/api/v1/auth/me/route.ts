import { NextResponse } from "next/server";
import { resolveAuthenticatedActor } from "@/lib/auth/resolve-authenticated-actor";
import { authErrorResponse } from "@/lib/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await resolveAuthenticatedActor(request);
    return NextResponse.json({
      user: {
        email: actor.email,
        displayName: actor.displayName,
        sector: actor.sector,
        role: actor.roleId,
        roleLabel: actor.roleLabel,
        sectorLabel: actor.sectorLabel,
        jobTitle: actor.jobTitle,
        redirectTo: actor.redirectTo,
      },
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}
