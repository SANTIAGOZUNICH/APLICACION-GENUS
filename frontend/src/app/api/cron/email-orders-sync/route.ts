import { NextResponse } from "next/server";
import { getEmailOrdersService } from "@/lib/email-orders/service";
import { isDatabaseConfigured } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron de pedidos por email: cada 15 minutos consulta Gmail (SOLO LECTURA), analiza los correos nuevos de los últimos días y deja BORRADORES
 * pendientes de aprobación. Nunca crea pedidos definitivos. Cada corrida queda en el historial con su resultado real (también si no hubo correos
 * o si Gmail/Gemini fallaron). Los correos con error se reintentan cada 30 minutos como mínimo, sin duplicar borradores.
 * Mismo esquema de seguridad que los otros crons: exige CRON_SECRET.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "CRON_SECRET no configurado." }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!isDatabaseConfigured()) return NextResponse.json({ ok: false, skipped: "sin base de datos" });
  try {
    const result = await getEmailOrdersService().analyze({ email: "cron@genus-os", sector: "PRODUCCION" }, { trigger: "cron", windowDays: 2, scan: 100, retryErrorsAfterMs: 30 * 60_000 });
    return NextResponse.json({ ok: result.status !== "error" && result.status !== "error_gmail", status: result.status, reason: result.reason, found: result.found, analyzed: result.analyzed, drafts: result.drafts, omitted: result.omitted, errors: result.errors.length });
  } catch (err) {
    // El motivo (Gmail/IA/sin conexión) ya quedó registrado en el historial de la corrida: acá solo se informa al cron.
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Error" });
  }
}
