import { NextResponse } from "next/server";
import { verifyState } from "@/lib/email-orders/crypto";
import { emailActor } from "@/lib/email-orders/http";
import { GMAIL_READONLY_SCOPE, oauthClient, oauthConfigStatus } from "@/lib/email-orders/gmail-oauth";
import { createGmailGateway } from "@/lib/email-orders/gateway";
import { getEmailOrdersService } from "@/lib/email-orders/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const back = (request: Request, ok: boolean, msg: string) => {
  const url = new URL("/mi-trabajo", request.url);
  url.searchParams.set("gmail", ok ? "ok" : "error");
  url.searchParams.set("msg", msg.slice(0, 160));
  const res = NextResponse.redirect(url);
  res.cookies.set("genus_gmail_oauth", "", { path: "/api/v1/email-orders/oauth", maxAge: 0 });
  return res;
};

/** Recibe el código de Google, lo canjea, verifica que sea la casilla autorizada y guarda el refresh token CIFRADO. Nada llega al navegador. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("error")) return back(request, false, "Google no concedió el permiso. No se conectó nada.");
    const code = url.searchParams.get("code");
    const st = verifyState(url.searchParams.get("state") ?? "");
    const actor = await emailActor(request);
    const nonce = request.headers.get("cookie")?.match(/(?:^|;\s*)genus_gmail_oauth=([^;]+)/)?.[1];
    if (!code || !st || !nonce || st.nonce !== nonce || st.email !== actor.email) return back(request, false, "La autorización venció o no es válida. Probá conectar de nuevo.");
    if (!oauthConfigStatus().ready) return back(request, false, "Falta configurar las credenciales de Google en el servidor.");
    const client = oauthClient(request.url);
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) return back(request, false, "Google no entregó un token de renovación. Revocá el acceso de GENUS OS en la cuenta y reconectá.");
    const scope = String(tokens.scope ?? "");
    // Permiso mínimo: si Google devolvió algo más que gmail.readonly, no se acepta.
    const scopes = scope.split(/\s+/).filter(Boolean);
    if (scopes.some((s) => s !== GMAIL_READONLY_SCOPE && !/^(openid|email|profile)$/.test(s))) return back(request, false, "Se concedieron permisos de más; solo se acepta lectura de Gmail.");
    const email = await createGmailGateway(tokens.refresh_token).accountEmail();
    await getEmailOrdersService().saveConnection(actor, { refreshToken: tokens.refresh_token, accountEmail: email, scope });
    return back(request, true, `Conectada la casilla ${email}.`);
  } catch (err) {
    return back(request, false, err instanceof Error ? err.message : "No se pudo conectar la casilla.");
  }
}
