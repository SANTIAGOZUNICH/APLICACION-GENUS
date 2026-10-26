import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { signState } from "@/lib/email-orders/crypto";
import { emailActor, emailError } from "@/lib/email-orders/http";
import { buildAuthUrl, describeConfigProblems, oauthConfigStatus } from "@/lib/email-orders/gmail-oauth";
import { canAccessProductionPedidos } from "@/lib/production-pedidos/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const COOKIE = "genus_gmail_oauth";

/** Inicia la autorización de Google (permiso gmail.readonly). Solo Producción. El estado va firmado y atado a un cookie (anti-CSRF). */
export async function GET(request: Request) {
  try {
    const actor = await emailActor(request);
    if (!canAccessProductionPedidos(actor)) return NextResponse.json({ error: "Solo Producción puede conectar la casilla de pedidos." }, { status: 403 });
    const cfg = oauthConfigStatus();
    if (!cfg.ready) return NextResponse.json({ error: `Configuración incompleta: ${describeConfigProblems(cfg)}.` }, { status: 503 });
    const nonce = randomBytes(16).toString("base64url");
    const state = signState({ email: actor.email, nonce, ts: Date.now() });
    const res = NextResponse.redirect(buildAuthUrl(request.url, state));
    res.cookies.set(COOKIE, nonce, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/v1/email-orders/oauth", maxAge: 600 });
    return res;
  } catch (err) {
    return emailError(err);
  }
}
