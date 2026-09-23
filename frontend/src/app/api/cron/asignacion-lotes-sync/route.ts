import { NextResponse } from "next/server";
import { syncAllEnabledSources } from "@/lib/asignacion-lotes/asignacion-lotes-sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mecanismo PRINCIPAL de sincronización automática (server-side, no
 * depende de que alguien tenga GENUS OS abierto) — mismo patrón que
 * GENUS-CRM usa para su propio sync de Sheets (ver
 * SANTIAGOZUNICH/GENUS-CRM: src/app/api/cron/sync-leads/route.ts):
 * Vercel Cron llamando periódicamente al MISMO `syncAllEnabledSources`
 * que también dispara "Sincronizar ahora" y el sync oportunista — una
 * sola implementación de sync, nunca dos. Frecuencia en vercel.json
 * (cada 10 minutos, igual que GENUS-CRM en el mismo equipo de Vercel —
 * confirma que el plan permite cron más frecuente que 1 vez/día).
 *
 * El sync oportunista (ver
 * asignacion-lotes-sync-service.ts#isDueForOpportunisticSync, disparado
 * al abrir la pantalla de Asignación de Lotes) queda como bonus de
 * frescura, no como mecanismo principal — este cron es el que garantiza
 * que la sincronización ocurra aunque nadie abra GENUS OS.
 *
 * Vercel firma este request con Authorization: Bearer <CRON_SECRET> —
 * nunca se acepta sin ese secreto configurado y coincidente. IMPORTANTE:
 * CRON_SECRET debe estar seteado en Vercel (Production) para que este
 * cron funcione — si falta, Vercel igual invoca este endpoint en el
 * horario programado pero recibe 500 y el cron nunca sincroniza nada
 * (bug real encontrado: CRON_SECRET nunca se configuró para este
 * proyecto, a diferencia de GENUS-CRM).
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
