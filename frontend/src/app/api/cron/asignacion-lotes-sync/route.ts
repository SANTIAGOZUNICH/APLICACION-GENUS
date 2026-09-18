import { NextResponse } from "next/server";
import { syncAllEnabledSources } from "@/lib/asignacion-lotes/asignacion-lotes-sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Respaldo diario (Vercel Cron, plan Hobby = 1 vez/día máximo). El
 * mecanismo PRINCIPAL de sincronización es el sync oportunista disparado
 * desde la pantalla de Asignación de Lotes (ver
 * asignacion-lotes-sync-service.ts#isDueForOpportunisticSync) — esto es
 * solo una red de seguridad para cuando el módulo no se abre por un rato.
 * Vercel firma este request con Authorization: Bearer <CRON_SECRET> —
 * nunca se acepta sin ese secreto configurado y coincidente.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET no configurado." }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const results = await syncAllEnabledSources("cron", "cron");
  return NextResponse.json({ ok: true, sourcesSynced: results.length, results });
}
