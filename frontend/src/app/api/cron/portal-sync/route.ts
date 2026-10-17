import { NextResponse } from "next/server";
import { reconcileNewClients } from "@/lib/portal/client-identity";
import { retryPendingEmails, scanPortalNotifications } from "@/lib/portal/notify-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron del Portal de Clientes: genera avisos «producto listo» (sin duplicados) y reintenta correos pendientes.
 * Mismo esquema de seguridad que los otros crons: exige CRON_SECRET. Con el correo desactivado (PORTAL_EMAIL_MODE != live)
 * no se envía nada: los avisos quedan registrados en el portal y los correos como «sin proveedor».
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "CRON_SECRET no configurado." }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  // Red de seguridad: clientes nuevos que algún proceso no pasó por el alta central (solo desde la fecha de corte).
  const codes = await reconcileNewClients().catch(() => ({ checked: 0, created: 0, failed: -1 }));
  const scan = await scanPortalNotifications();
  const retry = await retryPendingEmails();
  return NextResponse.json({ ok: true, codes, scan, retry });
}
