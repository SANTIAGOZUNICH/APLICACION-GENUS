import { NextResponse } from "next/server";
import { inspectAdminActivation, redeemAdminActivation } from "@/lib/auth/admin-activation";
import { authErrorResponse } from "@/lib/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

/**
 * Pública, pero inútil sin un token de un solo uso emitido por el superadministrador (256 bits, hash en base, vence en 30 min).
 * No elige sector ni rol: la cuenta es siempre ADMINISTRACION / ROL-AD / ACTIVO y solo para el correo fijo de Administración.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { action?: string; token?: string; password?: string } | null;
  const token = typeof body?.token === "string" ? body.token : "";
  try {
    if (body?.action === "inspect") return NextResponse.json(await inspectAdminActivation(token), { headers: HEADERS });
    if (body?.action === "redeem") {
      const out = await redeemAdminActivation(token, typeof body.password === "string" ? body.password : "");
      return NextResponse.json({ ok: true, email: out.email }, { headers: HEADERS });
    }
    return NextResponse.json({ error: "No encontrado." }, { status: 404, headers: HEADERS });
  } catch (err) {
    return authErrorResponse(err);
  }
}
