import { NextResponse } from "next/server";
import { getAdminAccountStatus, issueAdminActivation, revokeAdminActivation } from "@/lib/auth/admin-activation";
import { authErrorResponse } from "@/lib/auth/http";
import { requireSuperadminActor } from "@/lib/auth/require-superadmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

/** Solo el superadministrador autenticado (404 para cualquier otro): estado de la cuenta de Administración. */
export async function GET(request: Request) {
  try {
    await requireSuperadminActor(request);
    return NextResponse.json({ status: await getAdminAccountStatus() }, { headers: HEADERS });
  } catch (err) {
    return authErrorResponse(err);
  }
}

/** Emite un enlace de un solo uso (30 min). El token se devuelve UNA vez en el fragmento de la URL y no se guarda en claro. */
export async function POST(request: Request) {
  try {
    const actor = await requireSuperadminActor(request);
    const { token, expiresAt } = await issueAdminActivation(actor.email);
    const origin = new URL(request.url).origin;
    return NextResponse.json({ url: `${origin}/activar-administracion#t=${token}`, expiresAt }, { headers: HEADERS });
  } catch (err) {
    return authErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await requireSuperadminActor(request);
    return NextResponse.json({ revoked: await revokeAdminActivation(actor.email) }, { headers: HEADERS });
  } catch (err) {
    return authErrorResponse(err);
  }
}
